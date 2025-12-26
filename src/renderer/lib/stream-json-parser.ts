/**
 * Claude stream-json 输出解析器
 *
 * 解析 claude CLI 的 --output-format stream-json 输出
 * 处理分包、粘包和 ANSI 码
 */

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  event?: {
    type: string;
    index?: number;
    delta?: {
      type?: string;
      text?: string;
    };
    content_block?: {
      type: string;
      text?: string;
    };
    message?: {
      content?: Array<{ type: string; text?: string }>;
    };
  };
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  result?: string;
  total_cost_usd?: number;
  model?: string;
  modelUsage?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ReviewStatus = 'idle' | 'initializing' | 'streaming' | 'complete' | 'error';

export class StreamJsonParser {
  private buffer = '';
  // ANSI escape code regex - uses string constructor to avoid lint warning about control chars
  // biome-ignore lint/complexity/useRegexLiterals: Using RegExp constructor to avoid control character lint error in literal
  private readonly ansiRegex = new RegExp(
    '[\\u001b\\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]',
    'g'
  );

  /**
   * 解析输入数据块，返回解析出的事件数组
   */
  parse(chunk: string): StreamEvent[] {
    // 1. 拼接到 buffer
    this.buffer += chunk;

    // 2. 按行分割
    const lines = this.buffer.split(/\r?\n/);

    // 3. 保留最后一行（可能不完整）
    this.buffer = lines.pop() || '';

    const events: StreamEvent[] = [];

    for (const line of lines) {
      // 4. 清理 ANSI 码和首尾空白
      const cleanLine = line.replace(this.ansiRegex, '').trim();
      if (!cleanLine) continue;

      try {
        // 5. 尝试解析 JSON (只解析以 { 开头的行)
        if (cleanLine.startsWith('{')) {
          const event = JSON.parse(cleanLine) as StreamEvent;
          events.push(event);
        }
      } catch {
        // 忽略非 JSON 行 (如 shell prompt 或 echo)
      }
    }

    return events;
  }

  /**
   * 从事件中提取文本增量
   * 注意：不处理 result 事件（最终总结），避免重复输出
   */
  static extractTextDelta(event: StreamEvent): string | null {
    // stream_event with content_block_delta
    if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
      return event.event.delta?.text || null;
    }

    // assistant message - 不处理，使用 --include-partial-messages 时
    // stream_event 已经输出了增量文本，assistant 包含完整消息会重复

    // result message - 不输出，这是最终总结会重复内容

    return null;
  }

  /**
   * 检查是否是消息结束事件（需要在后面加换行）
   */
  static isMessageEndEvent(event: StreamEvent): boolean {
    return event.type === 'stream_event' && event.event?.type === 'message_stop';
  }

  /**
   * 检查事件类型
   */
  static isInitEvent(event: StreamEvent): boolean {
    return event.type === 'system' && event.subtype === 'init';
  }

  static isStreamEvent(event: StreamEvent): boolean {
    return event.type === 'stream_event';
  }

  static isResultEvent(event: StreamEvent): boolean {
    return event.type === 'result';
  }

  static isErrorEvent(event: StreamEvent): boolean {
    return event.type === 'system' && event.subtype === 'error';
  }

  /**
   * 从 result 事件中提取费用
   */
  static extractCost(event: StreamEvent): number | null {
    if (event.type === 'result' && typeof event.total_cost_usd === 'number') {
      return event.total_cost_usd;
    }
    return null;
  }

  /**
   * 从 result 事件中提取模型
   */
  static extractModel(event: StreamEvent): string | null {
    if (event.type === 'result') {
      // 优先从 model 字段获取
      if (typeof event.model === 'string') {
        return event.model;
      }
      // 从 modelUsage 的 key 获取
      if (event.modelUsage) {
        const models = Object.keys(event.modelUsage);
        if (models.length > 0) {
          return models[0];
        }
      }
    }
    return null;
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.buffer = '';
  }
}
