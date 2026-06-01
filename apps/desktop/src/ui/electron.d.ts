export {};

declare global {
  interface Window {
    sistema?: {
      platform: string;
      saveReportPdf: (html: string) => Promise<{ canceled: boolean; filePath?: string }>;
      previewReportPdf: (html: string) => Promise<{ canceled: boolean; filePath?: string }>;
    };
  }
}
