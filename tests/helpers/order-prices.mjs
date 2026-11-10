import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { priceInheritanceCtes } from '../../app/api/_lib/price-inheritance.ts';
const source = await readFile(new URL('../../app/api/_lib/order-prices.ts', import.meta.url),'utf8');
const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm,''), { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext } }).outputText;
export const orderPricesSql = new Function('priceInheritanceCtes',js.replace('export function orderPricesSql','return function orderPricesSql'))(priceInheritanceCtes);
