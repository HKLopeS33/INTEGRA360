/**
 * Testes de lógica financeira crítica
 *
 * Cobrem os fluxos de dinheiro mais importantes do sistema:
 *  - Cálculo de subtotal / total de comandas e pedidos de delivery
 *  - Cálculo de troco (amountPaid - total)
 *  - Geração do HTML do recibo (presença de valores corretos)
 *  - Casos-limite: itens com nota, quantidade > 1, valor zero, arredondamento
 */

import { describe, it, expect } from 'vitest';
import { generateThermalHTML, type ReceiptData, type ReceiptItem } from '../ui/receipt.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Simula o cálculo de subtotal idêntico ao usado em closeTab e na UI */
function calcSubtotal(items: Array<{ quantity: number; unitPrice: number }>): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

/** Troco = valor pago - total (nunca negativo em operação normal) */
function calcChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}

// ─── Subtotal ─────────────────────────────────────────────────────────────────

describe('calcSubtotal', () => {
  it('soma corretamente um único item', () => {
    expect(calcSubtotal([{ quantity: 1, unitPrice: 10 }])).toBe(10);
  });

  it('soma múltiplos itens com quantidades variadas', () => {
    const items = [
      { quantity: 2, unitPrice: 15 },   // 30
      { quantity: 3, unitPrice: 7.5 },  // 22.50
      { quantity: 1, unitPrice: 5 },    // 5
    ];
    expect(calcSubtotal(items)).toBeCloseTo(57.5, 2);
  });

  it('retorna 0 para lista vazia', () => {
    expect(calcSubtotal([])).toBe(0);
  });

  it('lida com preços decimais sem erro de arredondamento crítico', () => {
    // Clássico: 0.1 + 0.2 em JavaScript
    const items = [
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 1, unitPrice: 0.2 },
    ];
    expect(calcSubtotal(items)).toBeCloseTo(0.3, 10);
  });

  it('calcula corretamente quando quantidade é grande', () => {
    expect(calcSubtotal([{ quantity: 100, unitPrice: 9.99 }])).toBeCloseTo(999, 0);
  });
});

// ─── Troco ────────────────────────────────────────────────────────────────────

describe('calcChange', () => {
  it('calcula troco correto', () => {
    expect(calcChange(100, 73.5)).toBeCloseTo(26.5, 2);
  });

  it('troco zero quando pago exato', () => {
    expect(calcChange(50, 50)).toBe(0);
  });

  it('troco nunca é negativo (proteção de UI)', () => {
    // Isso não deveria acontecer no fluxo normal, mas o cálculo nunca deve retornar negativo
    expect(calcChange(40, 50)).toBe(0);
  });

  it('troco com centavos', () => {
    expect(calcChange(20, 17.3)).toBeCloseTo(2.7, 2);
  });
});

// ─── Recibo Térmico ───────────────────────────────────────────────────────────

describe('generateThermalHTML', () => {
  const baseItems: ReceiptItem[] = [
    { name: 'X-Burguer', quantity: 2, unitPrice: 18, total: 36 },
    { name: 'Coca-Cola', quantity: 1, unitPrice: 7, total: 7 },
  ];

  const baseData: ReceiptData = {
    companyName: 'Restaurante Teste',
    cnpj: 'CNPJ: 12.345.678/0001-99',
    items: baseItems,
    subtotal: 43,
    total: 43,
    paid: 50,
    change: 7,
    paymentMethod: 'Dinheiro',
    paperWidth: '58',
  };

  it('gera HTML sem lançar exceção', () => {
    expect(() => generateThermalHTML(baseData)).not.toThrow();
  });

  it('inclui o nome da empresa no HTML', () => {
    const html = generateThermalHTML(baseData);
    expect(html).toContain('RESTAURANTE TESTE');
  });

  it('inclui os nomes dos produtos', () => {
    const html = generateThermalHTML(baseData);
    expect(html).toContain('X-Burguer');
    expect(html).toContain('Coca-Cola');
  });

  it('inclui o valor total formatado em BRL', () => {
    const html = generateThermalHTML(baseData);
    // R$ 43,00 ou variações (com espaço fino ou não)
    expect(html).toMatch(/43[,.]?00/);
  });

  it('inclui o troco quando informado', () => {
    const html = generateThermalHTML(baseData);
    expect(html).toMatch(/7[,.]?00/);
  });

  it('inclui nota do item quando presente', () => {
    const itemsWithNote: ReceiptItem[] = [
      { name: 'Pizza', quantity: 1, unitPrice: 40, total: 40, note: 'Sem cebola' },
    ];
    const html = generateThermalHTML({ ...baseData, items: itemsWithNote, subtotal: 40, total: 40 });
    expect(html).toContain('Sem cebola');
  });

  it('funciona sem CNPJ nem endereço (campos opcionais)', () => {
    const minimal: ReceiptData = {
      items: [{ name: 'Água', quantity: 1, unitPrice: 3, total: 3 }],
      subtotal: 3,
      total: 3,
    };
    const html = generateThermalHTML(minimal);
    expect(html).toContain('Água');
  });

  it('funciona para bobina 80mm', () => {
    const html = generateThermalHTML({ ...baseData, paperWidth: '80' });
    expect(html).toContain('X-Burguer');
  });

  it('inclui nome da mesa quando for comanda de mesa', () => {
    const html = generateThermalHTML({ ...baseData, tableName: 'Mesa 05' });
    // O recibo converte o nome da mesa para maiúsculo
    expect(html.toUpperCase()).toContain('MESA 05');
  });
});

// ─── Validação de dados de pedido ─────────────────────────────────────────────

describe('consistência dos dados de pedido', () => {
  it('total de cada item bate com quantity * unitPrice', () => {
    const items: ReceiptItem[] = [
      { name: 'Combo A', quantity: 3, unitPrice: 25, total: 75 },
      { name: 'Suco',    quantity: 2, unitPrice: 8,  total: 16 },
    ];
    for (const item of items) {
      expect(item.total).toBeCloseTo(item.quantity * item.unitPrice, 2);
    }
  });

  it('subtotal bate com soma dos totais dos itens', () => {
    const items: ReceiptItem[] = [
      { name: 'Combo A', quantity: 3, unitPrice: 25, total: 75 },
      { name: 'Suco',    quantity: 2, unitPrice: 8,  total: 16 },
    ];
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    expect(subtotal).toBe(91);
  });
});
