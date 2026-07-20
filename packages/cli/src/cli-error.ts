export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export class BadRequestError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super("BAD_REQUEST", message, options);
  }
}
