-- ANA-31: token usage reported by the LLM providers (NULL when the API does not return it).

ALTER TABLE ai_usage ADD COLUMN input_tokens INTEGER;
ALTER TABLE ai_usage ADD COLUMN output_tokens INTEGER;
