function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function financialStatus(title) {
  if (title.CANCELADO === "S") return "Cancelado";
  if (title.DHBAIXA || title.DTBAIXA || numberValue(title.VLRBAIXA) > 0) return "Baixado";
  return "Pendente";
}

export function normalizeOrderDocuments(invoice, titles = []) {
  if (!invoice) {
    return {
      billed: false,
      invoice: null,
      nfe: { available: false, reason: "Pedido ainda não faturado." },
      boletos: [],
    };
  }

  const key = String(invoice.CHAVENFE || "").trim();
  const authorized = key.length === 44 && String(invoice.STATUSNFE || "").toUpperCase() === "A";
  return {
    billed: true,
    invoice: {
      nunota: numberValue(invoice.NUNOTA),
      number: String(invoice.NUMNOTA || ""),
      series: String(invoice.SERIENOTA || ""),
      company: numberValue(invoice.CODEMP),
      partnerCode: numberValue(invoice.CODPARC),
      partnerName: String(invoice.NOMEPARC || ""),
      value: numberValue(invoice.VLRNOTA),
      dueDate: invoice.DTVENC || null,
      status: String(invoice.STATUSNOTA || ""),
      nfeStatus: String(invoice.STATUSNFE || ""),
      key: key || null,
    },
    nfe: {
      available: authorized,
      xmlAvailable: authorized && String(invoice.POSSUIXML || "N") === "S",
      reason: authorized ? null : "NF-e ainda não autorizada ou indisponível.",
    },
    boletos: titles.map((title) => {
      const status = financialStatus(title);
      return {
        nufin: numberValue(title.NUFIN),
        value: numberValue(title.VLRDESDOB),
        dueDate: title.DTVENC || null,
        bank: String(title.NOMEBCO || title.CODBCO || "Não informado"),
        status,
        available: status === "Pendente" && numberValue(title.CODCTABCOINT) > 0,
      };
    }),
  };
}

export function publicDocumentError() {
  return "O Sankhya está temporariamente indisponível para consultar os documentos. Tente novamente.";
}
