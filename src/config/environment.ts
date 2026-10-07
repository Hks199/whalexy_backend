import 'dotenv/config';
import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  JWT_SECRET: Joi.string().min(48).required(),
  DATA_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),
  CORS_ORIGINS: Joi.string().required(),
  PUBLIC_URL: Joi.string().uri().required(),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  META_GRAPH_VERSION: Joi.string()
    .pattern(/^v\d+\.\d+$/)
    .default('v26.0'),
  META_APP_SECRET: Joi.string().allow('').default(''),
  META_WEBHOOK_VERIFY_TOKEN: Joi.string().allow('').default(''),
  WHALEXY_AI_SERVICE_URL: Joi.string().uri().allow('').default(''),
  WHALEXY_AI_API_KEY: Joi.string().allow('').default(''),
  GROQ_API_KEY: Joi.string().allow('').default(''),
  GROQ_MODEL: Joi.string().default('llama-3.3-70b-versatile'),
  PYTHON_BINARY: Joi.string().default('python'),
  UPLOAD_DIR: Joi.string().default('uploads'),
}).unknown(true);
export function validateEnvironment(input: NodeJS.ProcessEnv) {
  const { value, error } = schema.validate(input, { abortEarly: false });
  if (error)
    throw new Error(
      `Invalid configuration: ${error.details.map((d) => d.path.join('.')).join(', ')}`,
    );
  const origins = (value.CORS_ORIGINS as string).split(',').map((o: string) => o.trim());
  if (origins.some((o: string) => o === '*' || !/^https?:\/\//.test(o)))
    throw new Error('Explicit HTTP(S) CORS origins required');
  if (
    value.NODE_ENV === 'production' &&
    (!value.PUBLIC_URL.startsWith('https://') ||
      origins.some((o: string) => !o.startsWith('https://')))
  ) {
    throw new Error('Production public URL and CORS origins require HTTPS');
  }
  return { ...value, origins } as {
    NODE_ENV: string;
    PORT: number;
    DATABASE_URL: string;
    JWT_SECRET: string;
    DATA_ENCRYPTION_KEY: string;
    PUBLIC_URL: string;
    TRUST_PROXY_HOPS: number;
    LOG_LEVEL: string;
    origins: string[];
    META_GRAPH_VERSION: string;
    META_APP_SECRET: string;
    META_WEBHOOK_VERIFY_TOKEN: string;
    WHALEXY_AI_SERVICE_URL: string;
    WHALEXY_AI_API_KEY: string;
    GROQ_API_KEY: string;
    GROQ_MODEL: string;
    PYTHON_BINARY: string;
    UPLOAD_DIR: string;
  };
}
export const config = validateEnvironment(process.env);
