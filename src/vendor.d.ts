declare module 'xlsx' {
  export const utils: any;
  export function writeFile(workbook: any, filename: string): void;
}
declare module 'jspdf' {
  export class jsPDF {
    constructor(options?: any);
    text(value: string, x: number, y: number): void;
    save(filename: string): void;
    [key: string]: any;
  }
}
declare module 'jspdf-autotable' {
  const autoTable: (doc: any, options: any) => void;
  export default autoTable;
}
