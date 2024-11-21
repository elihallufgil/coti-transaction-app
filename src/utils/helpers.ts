import { AxiosError } from 'axios';

export async function exec<T>(p: Promise<T>): Promise<[any, T]> {
  return p
    .then((res: T): [any, T] => [null, res])
    .catch((error: any): [any, T] => [error, null]);
}

export function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export function axiosErrorHttpStatus(error: AxiosError) {
  return error.response?.status || 500;
}
