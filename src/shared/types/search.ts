// 文件名搜索参数
export interface FileSearchParams {
  rootPath: string;
  query: string;
  maxResults?: number;
  useGitignore?: boolean; // 是否跳过 .gitignore 中的文件，默认 true
}

// 内容搜索参数
export interface ContentSearchParams {
  rootPath: string;
  query: string;
  maxResults?: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  filePattern?: string; // glob pattern, e.g. "*.ts"
  useGitignore?: boolean; // 是否跳过 .gitignore 中的文件，默认 true
}

// 文件名搜索结果
export interface FileSearchResult {
  path: string;
  name: string;
  relativePath: string;
  score: number;
}

// 内容搜索匹配项
export interface ContentSearchMatch {
  path: string;
  relativePath: string;
  line: number;
  column: number; // 0-based column position
  matchLength: number; // length of matched text
  content: string;
  beforeContext?: string[];
  afterContext?: string[];
}

// 内容搜索结果
export interface ContentSearchResult {
  matches: ContentSearchMatch[];
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
}
