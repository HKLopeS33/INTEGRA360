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

// 58mm térmico — ~32 caracteres por linha em 13px Courier
const LINE_WIDTH = 32;

export function generateThermalHTML(data: ReceiptData) {
  const now = data.date ? new Date(data.date) : new Date();
  const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}`;

  const company = (data.companyName ?? 'ESTABELECIMENTO').toUpperCase();
  const cnpj    = data.cnpj ?? '';
  const address = data.address ?? '';
  const phone   = data.phone ?? '';
  const receiptNo = data.receiptNumber
    ? String(data.receiptNumber).padStart(6, '0')
    : '000000';
  const tableName = data.tableName ? `MESA: ${data.tableName.toUpperCase()}` : '';

  // Itens: nome (max 18), qtd (3), total (9) — total 32
  const NAME_W  = 18;
  const QTY_W   = 3;
  const TOTAL_W = 9;

  const itemsLines = data.items
    .map((item) => {
      const rawName = item.name.length > NAME_W
        ? `${item.name.slice(0, NAME_W - 2)}..`
        : item.name;
      const name  = padRight(rawName, NAME_W);
      const qty   = padLeft(String(item.quantity), QTY_W);
      const total = padLeft(
        formatCurrency(item.total).replace('R$ ', 'R$'),
        TOTAL_W
      );
      return `${name} ${qty} ${total}`;
    })
    .join('\n');

  // Linha de subtítulo da tabela
  const headerLine = `${padRight('PRODUTO', NAME_W)} QTD${padLeft('TOTAL', TOTAL_W + 1)}`;

  const sep = '-'.repeat(LINE_WIDTH);

  const paymentText = (data.paymentMethod ?? 'DINHEIRO').toUpperCase();
  const totalText   = formatCurrency(data.total).replace('R$ ', 'R$');
  const paidText    = data.paid != null
    ? formatCurrency(data.paid).replace('R$ ', 'R$')
    : null;
  const changeText  = data.change != null
    ? formatCurrency(data.change).replace('R$ ', 'R$')
    : null;

  const totalLine  = `${padRight('TOTAL', LINE_WIDTH - totalText.length)}${totalText}`;
  const payLine    = `${padRight('PAGAMENTO', LINE_WIDTH - paymentText.length)}${paymentText}`;
  const paidLine   = paidText
    ? `${padRight('RECEBIDO', LINE_WIDTH - paidText.length)}${paidText}`
    : '';
  const changeLine = changeText
    ? `${padRight('TROCO', LINE_WIDTH - changeText.length)}${changeText}`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Comprovante</title>
  <style>
    /* Controla exatamente o tamanho do papel e margens na impressora */
    @page {
      size: 58mm auto;
      margin: 2mm 1mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 56mm;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      line-height: 1.5;
      color: #000;
      background: #fff;
    }
    .ticket { width: 100%; }
    .center { text-align: center; }
    .sep       { border-top: 1px dashed #000; margin: 4px 0; }
    .sep-solid { border-top: 1px solid  #000; margin: 4px 0; }
    .company { font-size: 14px; font-weight: 700; letter-spacing: 1px; margin-bottom: 2px; }
    .info    { font-size: 12px; line-height: 1.4; }
    .pre     { white-space: pre; font-size: 12.5px; line-height: 1.45; }
    .bold    { font-weight: 700; }
    .footer  { font-size: 11px; line-height: 1.5; text-align: center; margin-top: 6px; }
    @media print {
      html, body { width: 56mm; }
    }
  </style>
</head>
<body>
  <div class="ticket">

    <div class="center company">${company}</div>
    ${cnpj    ? `<div class="center info">${cnpj}</div>` : ''}
    ${address ? `<div class="center info">${address}</div>` : ''}
    ${phone   ? `<div class="center info">${phone}</div>` : ''}

    <div class="sep-solid"></div>

    <div class="info"><span class="bold">CUPOM Nº</span> ${receiptNo}</div>
    <div class="info"><span class="bold">DATA:</span> ${dateStr}</div>
    ${tableName ? `<div class="info"><span class="bold">${tableName}</span></div>` : ''}

    <div class="sep"></div>

    <div class="pre bold">${headerLine}</div>
    <div class="sep"></div>
    <div class="pre">${itemsLines}</div>
    <div class="sep-solid"></div>

    <div class="pre bold">${totalLine}</div>
    <div class="sep"></div>
    <div class="pre">${payLine}</div>
    ${paidLine   ? `<div class="pre">${paidLine}</div>`   : ''}
    ${changeLine ? `<div class="pre bold">${changeLine}</div>` : ''}

    <div class="sep-solid"></div>

    <div class="footer">
      Obrigado pela preferência!<br>
      Volte sempre!<br><br>
      <span style="letter-spacing:3px">||||| ${String(receiptNo).slice(-5)} |||||</span><br>
      <em style="font-size:10px">SEM VALOR FISCAL</em>
    </div>

  </div>
  <script>window.onload = function(){ setTimeout(() => window.print(), 250); }</script>
</body>
</html>`;
}

export function printReceipt(data: ReceiptData) {
  const html = generateThermalHTML(data);
  const w = window.open('', '_blank', 'width=240,height=700,toolbar=no,menubar=no');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
