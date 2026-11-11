import axios from 'axios';

export interface RequestLog {
  id: string;
  time: string;
  method: string;
  url: string;
  status: number | 'network';
  request: unknown;
  response: unknown;
}

let logs: RequestLog[] = [];
const listeners = new Set<() => void>();
export const requestLog = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => logs,
  clear() {
    logs = [];
    listeners.forEach((listener) => listener());
  },
};

function record(
  method: string | undefined,
  url: string,
  status: RequestLog['status'],
  request: unknown,
  response: unknown,
) {
  // Только данные учебных API. Заголовки и внутренние токены в журнал не попадают.
  logs = [
    {
      id: crypto.randomUUID(),
      time: new Date().toLocaleTimeString('ru-RU'),
      method: (method ?? 'get').toUpperCase(),
      url,
      status,
      request,
      response,
    },
    ...logs,
  ].slice(0, 40);
  listeners.forEach((listener) => listener());
}

function parseBody(body: unknown) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function makeClient(baseURL: string) {
  const instance = axios.create({ baseURL, timeout: 12000 });
  instance.interceptors.response.use(
    (response) => {
      record(
        response.config.method,
        `${baseURL}${response.config.url}`,
        response.status,
        parseBody(response.config.data),
        response.data,
      );
      return response;
    },
    (error: unknown) => {
      if (axios.isCancel(error)) return Promise.reject(error);
      if (axios.isAxiosError(error)) {
        record(
          error.config?.method,
          `${baseURL}${error.config?.url ?? ''}`,
          error.response?.status ?? 'network',
          parseBody(error.config?.data),
          error.response?.data ?? error.message,
        );
      }
      return Promise.reject(error);
    },
  );
  return instance;
}

export const ordersApi = makeClient('/api/orders');
export const paymentsApi = makeClient('/api/payments');

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message: unknown = error.response?.data?.message;
    return Array.isArray(message)
      ? message.join('; ')
      : typeof message === 'string'
        ? message
        : 'Сервис недоступен. Проверьте, что оба бэкенда запущены.';
  }
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}
