-- ANA-193 (фидбек старшей команды 16.11): «История»/бэкфилл не давали зафиксировать и
-- отслеживать плановые 300 билетов — план живёт только внутри payload'а каждого снапшота.
-- Скалярные мет-колонки «цель → оплачено» держат список Истории без парсинга payload'ов
-- (ANA-154 жива), а этот бэкфилл достаёт их из уже сохранённых payload'ов. Правило расчёта —
-- shared snapshotKpiMeta (code/shared/src/kpi.ts): новый payload (b2cPaidTickets) — точно
-- B2C+B2B; legacy — зачтено = max(0, target − max(0, gap)), но факт B2B (320 > target)
-- важнее шапки; мусор / неполные данные → NULL (анти-галлюцинация: никаких выдуманных
-- чисел). Инвариант «заявка ≠ оплата»: b2cApplications в оплату не входят никогда.
ALTER TABLE report_snapshots ADD COLUMN kpi_target REAL;
ALTER TABLE report_snapshots ADD COLUMN kpi_paid REAL;

UPDATE report_snapshots SET
  kpi_target = json_extract(payload, '$.kpi.target'),
  kpi_paid = CASE
    WHEN json_type(payload, '$.kpi.b2cPaidTickets') IN ('integer', 'real') THEN
      max(json_extract(payload, '$.kpi.b2cPaidTickets'), 0)
        + max(json_extract(payload, '$.kpi.b2bPaidTickets'), 0)
    ELSE
      max(
        max(json_extract(payload, '$.kpi.target')
              - max(coalesce(json_extract(payload, '$.kpi.gap'), 0), 0), 0),
        max(coalesce(json_extract(payload, '$.kpi.b2bPaidTickets'), 0), 0)
      )
  END
WHERE CASE
  WHEN payload IS NULL OR NOT json_valid(payload) THEN 0
  WHEN json_type(payload, '$.kpi') <> 'object' THEN 0
  WHEN json_type(payload, '$.kpi.target') NOT IN ('integer', 'real') THEN 0
  WHEN json_type(payload, '$.kpi.b2cPaidTickets') IN ('integer', 'real') THEN
    json_type(payload, '$.kpi.b2bPaidTickets') IN ('integer', 'real')
  ELSE
    json_type(payload, '$.kpi.b2bPaidTickets') IN ('integer', 'real')
    AND json_type(payload, '$.kpi.gap') IN ('integer', 'real')
END;
