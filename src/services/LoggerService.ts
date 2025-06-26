import * as vscode from "vscode";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class LoggerService {
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.INFO;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Ant Review Plugin");
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level];
    let formattedMessage = `[${timestamp}] [${levelStr}] ${message}`;

    if (data !== undefined) {
      if (typeof data === "object") {
        formattedMessage += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formattedMessage += ` ${data}`;
      }
    }

    return formattedMessage;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formattedMessage = this.formatMessage(
        LogLevel.DEBUG,
        message,
        data
      );
      this.outputChannel.appendLine(formattedMessage);
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formattedMessage = this.formatMessage(LogLevel.INFO, message, data);
      this.outputChannel.appendLine(formattedMessage);
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formattedMessage = this.formatMessage(LogLevel.WARN, message, data);
      this.outputChannel.appendLine(formattedMessage);
    }
  }

  error(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formattedMessage = this.formatMessage(
        LogLevel.ERROR,
        message,
        data
      );
      this.outputChannel.appendLine(formattedMessage);
    }
  }

  logOperation(operation: string, details?: any): void {
    this.info(`Operation: ${operation}`, details);
  }

  logServiceCall(service: string, method: string, params?: any): void {
    this.debug(`Service call: ${service}.${method}`, params);
  }

  logServiceResponse(service: string, method: string, response?: any): void {
    this.debug(`Service response: ${service}.${method}`, response);
  }

  logError(operation: string, error: any): void {
    this.error(`Error in ${operation}`, {
      message: error.message || error,
      stack: error.stack,
    });
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  clear(): void {
    this.outputChannel.clear();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}
