export const REDIS_KEYS = Object.freeze({
  ONCALL_CONFIG: 'telegram_web:oncall:config',
  CUSTOMER_SERVICE_SUCCESS_CASES: 'telegram_web:customer-service:success-cases',
  CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE: 'telegram_web:customer-service:scenario-knowledge',
  CUSTOMER_SERVICE_SUSPEND_GATES: 'telegram_web:customer-service:suspend-gates',
});

export const REDIS_CACHE_TTL_MS = Object.freeze({
  ONCALL_CONFIG: 2000,
});
