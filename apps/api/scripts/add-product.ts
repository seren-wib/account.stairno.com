// FR-34: register a product. Runs on the operator's machine against the database in DATABASE_URL
// (Neon in production, the local proxy in development):
//
//   npm run admin:add-product --workspace apps/api -- --sku atlas-odyssey-desktop \
//     --client-id <site client_id> --name-ko "아틀라스 오디세이 데스크톱" \
//     --name-en "Atlas Odyssey Desktop" --kind one_time --price KRW:12000 --price USD:900 \
//     --download-key atlas-odyssey/1.0.0/setup.exe
//
// --kind subscription needs --interval month|year. Amounts are integers in won or cents (DR-9).
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { addProduct } from '../src/admin/add-product';
import { createDb } from '../src/db/client';

const { values } = parseArgs({
  options: {
    sku: { type: 'string' },
    'client-id': { type: 'string' },
    'name-ko': { type: 'string' },
    'name-en': { type: 'string' },
    kind: { type: 'string' },
    interval: { type: 'string' },
    price: { type: 'string', multiple: true },
    'download-key': { type: 'string' },
  },
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const prices = (values.price ?? []).map((entry) => {
  const [currency, amount] = entry.split(':');
  return { currency, amount: Number(amount) };
});

try {
  const product = await addProduct(createDb(databaseUrl), {
    sku: values.sku,
    clientId: values['client-id'],
    nameKo: values['name-ko'],
    nameEn: values['name-en'],
    kind: values.kind,
    interval: values.interval,
    prices,
    downloadKey: values['download-key'],
  });
  console.log(`product ${product.sku} ${product.id}`);
} catch (error) {
  if (error instanceof ZodError) {
    for (const issue of error.issues) console.error(`${issue.path.join('.')}: ${issue.message}`);
  } else {
    console.error((error as { cause?: Error }).cause?.message ?? (error as Error).message);
  }
  process.exit(1);
}
