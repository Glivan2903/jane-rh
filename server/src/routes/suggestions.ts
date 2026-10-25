import { Router } from 'express';
import { z } from 'zod';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, h, parse, qty, reqInt, today } from '../util.js';
import { purchaseSuggestions } from '../services/suggestions.js';
import { createDraftOrder, orderSchema } from './estx.js';

export const suggestionsRouter = Router();

/** Só lista o que a pessoa pode consultar; confirmar exige a permissão da própria ação. */
suggestionsRouter.get('/', requireAuth(), h(async (req, res) => {
  const out = hasPerm(req, 'est.view') ? await purchaseSuggestions() : [];
  res.json({ rows: out, can: { purchase_order: hasPerm(req, 'est.create') } });
}));

const confirmSchema = z.object({
  partyId: reqInt,
  items: z.array(z.object({ productId: z.string().uuid(), quantity: qty, unitCost: z.coerce.number().min(0).max(999999999) })).min(1, 'Inclua ao menos um produto').max(200),
});

/** Cria o pedido de compra como RASCUNHO. Nunca envia ao fornecedor: o envio continua sendo feito na tela de pedidos. */
suggestionsRouter.post('/purchase-order/confirm', requireAuth('est.create'), h(async (req, res) => {
  const d = parse(confirmSchema, req.body);
  const order = parse(orderSchema, { partyId: d.partyId, orderDate: today(), items: d.items, notes: 'Criado a partir de uma sugestão do sistema (estoque no mínimo ou abaixo) e confirmado por ' + req.user!.name + '.' });
  const r = await createDraftOrder(req, order, ' a partir de sugestão');
  if (!r.id) throw new HttpError(500, 'Não foi possível criar o pedido.');
  res.status(201).json(r);
}));
