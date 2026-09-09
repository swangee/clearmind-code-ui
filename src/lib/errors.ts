import { Code, ConnectError } from "@connectrpc/connect";

export function errorText(cause: unknown, fallback: string): string {
  const error = ConnectError.from(cause);

  switch (error.code) {
    case Code.PermissionDenied:
      return "Недостатньо прав для цієї дії.";
    case Code.Unauthenticated:
      return "Сесія завершилася. Увійдіть знову.";
    case Code.Unavailable:
      return "Сервіс тимчасово недоступний. Спробуйте пізніше.";
    default:
      return error.rawMessage || fallback;
  }
}

export function loginErrorText(cause: unknown): string {
  const error = ConnectError.from(cause);

  switch (error.code) {
    case Code.Unauthenticated:
    case Code.InvalidArgument:
    case Code.NotFound:
      return "Невірне імʼя користувача або пароль.";
    default:
      return errorText(cause, "Не вдалося увійти.");
  }
}

export function googleLoginErrorText(cause: unknown): string {
  const error = ConnectError.from(cause);

  switch (error.code) {
    case Code.Unauthenticated:
    case Code.InvalidArgument:
      return "Google не підтвердив цей вхід. Спробуйте ще раз.";
    case Code.FailedPrecondition:
      return "Вхід через Google не налаштований у цьому розгортанні.";
    default:
      return errorText(cause, "Не вдалося увійти через Google.");
  }
}

export function channelErrorText(cause: unknown): string {
  const error = ConnectError.from(cause);

  switch (error.code) {
    case Code.InvalidArgument:
      return `Канал не додано: ${error.rawMessage || "некоректний ідентифікатор або платформа."}`;
    case Code.NotFound:
      return `Канал не додано: ${error.rawMessage || "такого каналу не існує."}`;
    default:
      return errorText(cause, "Не вдалося додати канал.");
  }
}

export function importFromSourceErrorText(cause: unknown, source: string): string {
  const reason = errorText(cause, "невідома помилка.");
  return `Імпорт із джерела «${source}» не завершився: ${reason} Частина каналів могла вже потрапити до каталогу — перелік нижче оновлено.`;
}
