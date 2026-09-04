export {};

declare global {
  interface Window {
    sistema?: {
      platform: string;
      saveReportPdf: (html: string) => Promise<{ canceled: boolean; filePath?: string }>;
      previewReportPdf: (html: string) => Promise<{ canceled: boolean; filePath?: string }>;
      onUpdaterStatus: (callback: (data: { event: string; version?: string; percent?: number; message?: string }) => void) => () => void;
      checkForUpdates: () => Promise<unknown>;
      installUpdate: () => void;
      listPrinters: () => Promise<Array<{ name: string; isDefault: boolean; status: number }>>;
      printSilent: (html: string, printerName: string) => Promise<{ success: boolean; reason?: string }>;
    };
  }
}
