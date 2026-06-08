export const REDIS_KEYS = Object.freeze({
  ONCALL_CONFIG: 'telegram-tt:oncall:config',
  CUSTOMER_SERVICE_SUCCESS_CASES: 'telegram-tt:customer-service:success-cases',
  CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE: 'telegram-tt:customer-service:scenario-knowledge',
});

export const REDIS_CACHE_TTL_MS = Object.freeze({
  ONCALL_CONFIG: 2000,
});
