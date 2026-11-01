/** A failed read of the site's data: `status` is what an HTTP route would have said (404 for "not a token"). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
