import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllQueryRows } from '../app/api/_lib/query-pagination.ts';

test('loads more than 5000 rows across all companies without leaking the pagination column', async () => {
  const source = Array.from({ length: 12005 }, (_, index) => ({ CODPROD: index + 1, CODEMP: index % 3 + 1 }));
  let calls = 0;
  const rows = await readAllQueryRows(async sql => {
    calls++;
    if (sql.includes('COUNT(*) FV_TOTAL')) return [{ FV_TOTAL: source.length }];
    const offset = Number(sql.match(/FV_ROW_NUMBER > (\d+)/)[1]);
    const end = Number(sql.match(/ROWNUM <= (\d+)/)[1]);
    return source.slice(offset, end).map((row, index) => ({ ...row, FV_ROW_NUMBER: offset + index + 1 }));
  }, 'SELECT CODPROD, CODEMP FROM PRODUCTS ORDER BY CODPROD');
  assert.deepEqual(rows, source);
  assert.equal(calls, 5);
  assert.equal(new Set(rows.map(row => row.CODEMP)).size, 3);
});

test('rejects incomplete loads instead of returning partial data', async () => {
  await assert.rejects(readAllQueryRows(async sql => {
    if (sql.includes('COUNT(*) FV_TOTAL')) return [{ FV_TOTAL: 5001 }];
    return [];
  }, 'SELECT ID FROM PRODUCTS'), /incompletos/);
  await assert.rejects(readAllQueryRows(async sql => {
    if (sql.includes('COUNT(*) FV_TOTAL')) return [{ FV_TOTAL: 5001 }];
    return [{ ID: 1, FV_ROW_NUMBER: 1 }];
  }, 'SELECT ID FROM PRODUCTS'), /incompletos/);
});

test('returns an empty complete load without querying pages', async () => {
  let calls = 0;
  assert.deepEqual(await readAllQueryRows(async () => {
    calls++;
    return [{ FV_TOTAL: 0 }];
  }, 'SELECT ID FROM PRODUCTS'), []);
  assert.equal(calls, 1);
});

test('propagates a failed page and rejects invalid record counts', async () => {
  await assert.rejects(readAllQueryRows(async () => [{ FV_TOTAL: null }], 'SELECT ID FROM PRODUCTS'), /quantidade/);
  await assert.rejects(readAllQueryRows(async sql => {
    if (sql.includes('COUNT(*) FV_TOTAL')) return [{ FV_TOTAL: 5001 }];
    throw new Error('Integration unavailable');
  }, 'SELECT ID FROM PRODUCTS'), /Integration unavailable/);
});
