export type ReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type ReceiptData = {
  companyName?: string;
  cnpj?: string;
  address?: string;
  phone?: string;
  receiptNumber?: string | number;
  consumer?: string;
  tableName?: string;
  items: ReceiptItem[];
  subtotal: number;
  total: number;
  paid?: number;
  change?: number;
  paymentMethod?: string;
  date?: string;
  nota?: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

function padRight(str: string, len: number) {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number) {
  if (str.length >= len) return str.slice(-len);
  return ' '.repeat(len - str.length) + str;
}

export function generateThermalHTML(data: ReceiptData) {
  const now = data.date ? new Date(data.date) : new Date();
  const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}`;

  const company = (data.companyName ?? 'MERCADO DO ZÉ').toUpperCase();
  const cnpj = data.cnpj ?? 'CNPJ: 00.000.000/0001-00';
  const address = data.address ?? 'Rua das Compras, 123 — Floresta/PE';
  const phone = data.phone ?? 'Fone: (87) 3333-0000';
  const receiptNo = data.receiptNumber ? String(data.receiptNumber).padStart(6, '0') : '000000';
  const consumer = (data.consumer ?? 'CONSUMIDOR FINAL').toUpperCase();

  const itemsLines = data.items
    .map((item) => {
      const name = item.name.length > 22 ? `${item.name.slice(0, 19)}...` : item.name;
      const qty = String(item.quantity);
      const unit = formatCurrency(item.unitPrice).replace('R$\u00A0', 'R$ ');
      const total = formatCurrency(item.total).replace('R$\u00A0', 'R$ ');
      return `${padRight(name, 22)} ${padLeft(qty, 3)} ${padLeft(unit, 8)} ${padLeft(total, 8)}`;
    })
    .join('\n');

  const paymentText = data.paymentMethod ?? 'DINHEIRO';
  const changeText = data.change != null ? formatCurrency(data.change).replace('R$\u00A0', 'R$ ') : 'R$ 0,00';
  const totalText = formatCurrency(data.total).replace('R$\u00A0', 'R$ ');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Comprovante</title>
  <style>
    body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 10px; color: #000; background: #fff; }
    .ticket { width: 80mm; max-width: 80mm; }
    .center { text-align: center; }
    .separator { border-top: 1px dashed #000; margin: 8px 0; }
    .company { font-size: 14px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
    .muted { font-size: 10px; line-height: 1.4; }
    .line { white-space: pre; font-size: 10px; line-height: 1.4; }
    .footer { font-size: 9px; line-height: 1.4; text-align: center; margin-top: 10px; }
    .barcode { font-family: monospace; letter-spacing: 2px; margin: 8px 0 0; }
    @media print { body { margin: 0; } .ticket { width: 80mm; padding: 0; } }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center company">${company}</div>
    <div class="center muted">${cnpj}</div>
    <div class="center muted">${address}</div>
    <div class="center muted">${phone}</div>
    <div class="separator"></div>
    <div class="muted"><strong>CUPOM FISCAL Nº ${receiptNo}</strong></div>
    <div class="muted">DATA/HORA: ${dateStr}</div>
    <div class="muted">${consumer}</div>
    <div class="separator"></div>
    <div class="line">PRODUTO                 QTD  VL.UN    TOTAL</div>
    <div class="separator"></div>
    <div class="line">${itemsLines}</div>
    <div class="separator"></div>
    <div class="line">TOTAL${padLeft(totalText, 36)}</div>
    <div class="line">PAGAMENTO${padLeft(paymentText, 28)}</div>
    <div class="line">TROCO${padLeft(changeText, 33)}</div>
    <div class="separator"></div>
    <div class="footer">
      Obrigado pela preferência!<br>
      Volte sempre!<br>
      <div class="barcode">||||| ${String(receiptNo).slice(-5)} |||||</div>
      00000${String(receiptNo)}<br>
      <em>DOCUMENTO SEM VALIDADE FISCAL OFICIAL</em>
    </div>
  </div>
  <script>window.onload=function(){setTimeout(()=>window.print(),200)}</script>
</body>
</html>`;
}

export function printReceipt(data: ReceiptData) {
  const html = generateThermalHTML(data);
  const w = window.open('', '_blank', 'width=420,height=800');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
