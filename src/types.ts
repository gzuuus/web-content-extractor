export interface ContentExtractionResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  isReadable: boolean;
}
