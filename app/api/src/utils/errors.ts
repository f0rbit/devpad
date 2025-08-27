export class DevpadApiError extends Error {
  readonly code?: string;
  readonly statusCode?: number;

  constructor(
    message: string, 
    options: { 
      code?: string, 
      statusCode?: number 
    } = {}
  ) {
    super(message);
    this.name = 'DevpadApiError';
    this.code = options.code;
    this.statusCode = options.statusCode;
  }

  static fromResponse(response: Response): DevpadApiError {
    return new DevpadApiError(
      `API request failed: ${response.statusText}`, 
      { 
        statusCode: response.status 
      }
    );
  }
}

export class AuthenticationError extends DevpadApiError {
  constructor(message: string = 'Authentication failed') {
    super(message, { code: 'AUTHENTICATION_ERROR' });
  }
}

export class NetworkError extends DevpadApiError {
  constructor(message: string = 'Network request failed') {
    super(message, { code: 'NETWORK_ERROR' });
  }
}

export class ValidationError extends DevpadApiError {
  constructor(message: string = 'Validation failed') {
    super(message, { code: 'VALIDATION_ERROR' });
  }
}