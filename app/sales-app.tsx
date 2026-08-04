"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Box,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  CloudCheck,
  CloudOff,
  Database,
  Download,
  FileText,
  Filter,
  Home,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sprout,
  UserRound,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  getLatestOfflineSnapshot,
  getOfflineSnapshot,
  OfflineSnapshot,
  saveOfflineSnapshot,
} from "./offline-store";

type ApiRow = Record<string, string | number | null>;
type Partner = ApiRow & {
  CODPARC: number;
  NOMEPARC: string;
  CODTAB?: number | null;
  GRUPOICMS?: number | null;
};
type Product = ApiRow & {
  CODPROD: number;
  DESCRPROD: string;
  CODVOL: string;
  CODLOCAL: number;
  CONTROLE: string;
  DISPONIVEL: number;
  NUTAB: number;
  VLRVENDA: number;
  DESCRGRUPOPROD?: string;
  MARCA?: string;
};
type CartItem = Product & { quantity: number };
type PriceTable = { CODTAB: number; NOMETAB: string };
type Negotiation = { CODTIPVENDA: number; DESCRTIPVENDA: string };
type ProductGroup = {
  CODGRUPOPROD: number;
  DESCRGRUPOPROD: string;
  CODGRUPAI?: number | null;
  GRAU?: number;
  ANALITICO?: string;
  ELEGIVEL?: number;
};
type ProductBrand = { MARCA: string };
type OrderPhase = "header" | "products" | "review";
type AppScreen = "home" | "general-sales" | "orders" | "new" | "clients" | "communication" | "more";
type AppHistoryView = AppScreen | "client-picker" | "logout";
type AppHistoryState = {
  norteSulVendas: true;
  view: AppHistoryView;
  baseScreen?: Exclude<AppScreen, "new">;
  phase?: OrderPhase;
  dialog?: "send" | "groups" | "brand" | "dashboard-detail";
  conversationId?: string;
};
type OrderDraft = {
  id: string;
  updatedAt: number;
  phase: OrderPhase;
  partner: Partner;
  priceCode: number;
  priceName: string;
  negotiation: number;
  negotiationName: string;
  observation: string;
  cart: CartItem[];
};

type ChatConversation = {
  id: string;
  other_user_id: number;
  other_user_name: string;
  updated_at: number;
  last_message?: string | null;
  last_message_at?: number | null;
  unread_count?: number;
};
type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: number;
  sender_name: string;
  body: string;
  created_at: number;
  read_at?: number | null;
};
type SankhyaChatUser = {
  CODUSU: number;
  NOME: string;
  LOGIN: string;
  CODVEND?: number | null;
};

type DashboardData = {
  summary: {
    SALES_VALUE: number;
    ORDER_COUNT: number;
    AVG_TICKET: number;
    CLIENT_COUNT: number;
    PENDING_VALUE: number;
  };
  dailySales: Array<{ SALE_DATE: string; SALES_VALUE: number; ORDER_COUNT: number }>;
  topProducts: Array<{ CODPROD: number; DESCRPROD: string; QUANTITY: number; SALES_VALUE: number }>;
  topClients: Array<{ CODPARC: number; NOMEPARC: string; SALES_VALUE: number; ORDER_COUNT: number }>;
  clientPortfolio: {
    NEW_CLIENTS: number;
    RECURRING_CLIENTS: number;
    REACTIVATED_CLIENTS: number;
    INACTIVE_30: number;
    INACTIVE_60: number;
    INACTIVE_90: number;
  };
  salesByGroup: Array<{ CODGRUPOPROD: number; DESCRGRUPOPROD: string; SALES_VALUE: number }>;
};
type DashboardDetailType = "day" | "products" | "groupProducts" | "clients" | "newClients" | "recurringClients" | "reactivatedClients" | "inactiveClients";
type DashboardDetailSelection = { type: DashboardDetailType; date?: string; groupId?: number; groupName?: string };
type DashboardSeller = { CODVEND: number; APELIDO: string };
type GeneralSalesCompany = { CODEMP: number; NOMEFANTASIA: string };
type GeneralSalesData = {
  summary: {
    SALES_VALUE: number;
    ORDER_COUNT: number;
    AVG_TICKET: number;
    CLIENT_COUNT: number;
    SELLER_COUNT: number;
    OPEN_ORDER_COUNT: number;
    OPEN_VALUE: number;
  };
  companies: Array<GeneralSalesCompany & {
    SALES_VALUE: number;
    ORDER_COUNT: number;
    AVG_TICKET: number;
    CLIENT_COUNT: number;
    SELLER_COUNT: number;
    OPEN_ORDER_COUNT: number;
    OPEN_VALUE: number;
  }>;
  sellers: Array<{ CODVEND: number; APELIDO: string; SALES_VALUE: number; ORDER_COUNT: number; CLIENT_COUNT: number; AVG_TICKET: number }>;
  groups: Array<{ CODGRUPOPROD: number; DESCRGRUPOPROD: string; SALES_VALUE: number; QUANTITY: number }>;
  monthly: Array<{ SALE_MONTH: string; SALES_VALUE: number; ORDER_COUNT: number }>;
};
const dashboardDetailKinds: Record<DashboardDetailType, string> = {
  day: "dashboardDay",
  products: "dashboardProducts",
  groupProducts: "dashboardGroupProducts",
  clients: "dashboardClients",
  newClients: "dashboardNewClients",
  recurringClients: "dashboardRecurringClients",
  reactivatedClients: "dashboardReactivatedClients",
  inactiveClients: "dashboardInactiveClients",
};

const OFFLINE_SESSION_KEY = "norte-sul-vendas:offline-session-enabled";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type Client = ApiRow & {
  CODPARC: number;
  NOMEPARC: string;
  CGCCPF?: string;
  TELEFONE?: string;
  EMAIL?: string;
  CODTAB?: number | null;
  GRUPOICMS?: number | null;
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const compactMoney = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value);

const inputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const daysAgo = (days: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return inputDate(date);
};

const currentMonthStart = () => {
  const today = new Date();
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1));
};

const displayPeriodDate = (value: string) => value.split("-").reverse().join("/");

const filterOrdersByPeriod = (rows: ApiRow[], dateFrom: string, dateTo: string) =>
  rows.filter((order) => {
    const raw = String(order.DTNEG ?? "");
    const date = /^\d{8}/.test(raw)
      ? `${raw.slice(4, 8)}-${raw.slice(2, 4)}-${raw.slice(0, 2)}`
      : raw.slice(0, 10);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  });

const reportColors = ["#087a4d", "#23a46d", "#6abc8d", "#d7b348", "#e17b45", "#4c84b8", "#8c6bb1", "#69766f"];

function salesGroupPie(groups: DashboardData["salesByGroup"]) {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const values = groups.map((item) => Math.max(0, Number(item.SALES_VALUE)));
  const total = values.reduce((sum, value) => sum + value, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!total) {
    context.fillStyle = "#e8efeb";
    context.beginPath();
    context.arc(360, 360, 290, 0, Math.PI * 2);
    context.fill();
  } else {
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const next = angle + (value / total) * Math.PI * 2;
      context.fillStyle = reportColors[index % reportColors.length];
      context.beginPath();
      context.moveTo(360, 360);
      context.arc(360, 360, 290, angle, next);
      context.closePath();
      context.fill();
      angle = next;
    });
  }
  context.fillStyle = "white";
  context.beginPath();
  context.arc(360, 360, 135, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL("image/png");
}

async function imageDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) return "";
  const blob = await response.blob();
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

async function downloadSalesReport(input: {
  dashboard: DashboardData;
  sellerName: string;
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
  products: ApiRow[];
  clients: ApiRow[];
}) {
  const { jsPDF } = await import("jspdf");
  const { dashboard, sellerName, periodLabel, products, clients } = input;
  const document = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const green = [7, 122, 77] as const;
  const darkGreen = [8, 74, 49] as const;
  const ink = [26, 42, 34] as const;
  const muted = [103, 119, 110] as const;
  const line = [221, 231, 225] as const;
  const soft = [237, 248, 242] as const;
  let y = 14;

  const pageHeader = () => {
    document.setFont("helvetica", "bold");
    document.setFontSize(8);
    document.setTextColor(...green);
    document.text("NORTE SUL SEMENTES - FORCA DE VENDAS", margin, 11);
    document.setDrawColor(...line);
    document.line(margin, 14, pageWidth - margin, 14);
    y = 20;
  };
  const newPage = () => {
    document.addPage();
    pageHeader();
  };
  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - 16) newPage();
  };
  const sectionTitle = (title: string, subtitle?: string) => {
    ensureSpace(subtitle ? 18 : 13);
    document.setFont("helvetica", "bold");
    document.setFontSize(12);
    document.setTextColor(...ink);
    document.text(title, margin, y);
    y += 5;
    if (subtitle) {
      document.setFont("helvetica", "normal");
      document.setFontSize(7.5);
      document.setTextColor(...muted);
      document.text(subtitle, margin, y);
      y += 5;
    }
    document.setDrawColor(...line);
    document.line(margin, y, pageWidth - margin, y);
    y += 7;
  };
  const table = (title: string, headers: string[], widths: number[], rows: Array<Array<string | number>>) => {
    sectionTitle(title, `${rows.length} registros ordenados por valor faturado.`);
    const drawHeader = () => {
      ensureSpace(10);
      document.setFillColor(...darkGreen);
      document.roundedRect(margin, y, contentWidth, 8, 2, 2, "F");
      document.setFont("helvetica", "bold");
      document.setFontSize(7);
      document.setTextColor(255, 255, 255);
      let x = margin + 3;
      headers.forEach((header, index) => {
        document.text(header, index === headers.length - 1 ? x + widths[index] - 3 : x, y + 5.2, { align: index === headers.length - 1 ? "right" : "left" });
        x += widths[index];
      });
      y += 9;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const wrapped = row.map((cell, index) => document.splitTextToSize(String(cell), Math.max(8, widths[index] - 6)) as string[]);
      const rowHeight = Math.max(8, Math.max(...wrapped.map((lines) => lines.length)) * 3.6 + 3);
      if (y + rowHeight > pageHeight - 16) {
        newPage();
        drawHeader();
      }
      if (rowIndex % 2 === 0) {
        document.setFillColor(247, 250, 248);
        document.rect(margin, y, contentWidth, rowHeight, "F");
      }
      document.setFont("helvetica", "normal");
      document.setFontSize(7.2);
      document.setTextColor(...ink);
      let x = margin + 3;
      wrapped.forEach((cellLines, index) => {
        document.text(cellLines, index === wrapped.length - 1 ? x + widths[index] - 3 : x, y + 5, { align: index === wrapped.length - 1 ? "right" : "left" });
        x += widths[index];
      });
      document.setDrawColor(...line);
      document.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      y += rowHeight;
    });
    y += 7;
  };

  document.setFillColor(...darkGreen);
  document.rect(0, 0, pageWidth, 54, "F");
  const logo = await imageDataUrl("/brand-logo.png").catch(() => "");
  if (logo) document.addImage(logo, "PNG", margin, 10, 28, 28, undefined, "FAST");
  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.setTextColor(255, 255, 255);
  document.text("Relatorio de vendas", logo ? 48 : margin, 20);
  document.setFontSize(10);
  document.setFont("helvetica", "normal");
  document.text(`Vendedor: ${sellerName}`, logo ? 48 : margin, 28);
  document.text(`Periodo: ${periodLabel}`, logo ? 48 : margin, 34);
  document.setFontSize(7.5);
  document.setTextColor(200, 231, 216);
  document.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, logo ? 48 : margin, 41);
  y = 64;

  const cards = [
    ["Faturamento", money(Number(dashboard.summary.SALES_VALUE))],
    ["Pedidos faturados", Number(dashboard.summary.ORDER_COUNT).toLocaleString("pt-BR")],
    ["Ticket medio", money(Number(dashboard.summary.AVG_TICKET))],
    ["Clientes atendidos", Number(dashboard.summary.CLIENT_COUNT).toLocaleString("pt-BR")],
  ];
  const cardGap = 3;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  cards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + cardGap);
    document.setFillColor(...soft);
    document.roundedRect(x, y, cardWidth, 22, 3, 3, "F");
    document.setFont("helvetica", "normal");
    document.setFontSize(6.5);
    document.setTextColor(...muted);
    document.text(label, x + 4, y + 7);
    document.setFont("helvetica", "bold");
    document.setFontSize(index === 0 || index === 2 ? 10 : 13);
    document.setTextColor(...green);
    document.text(value, x + 4, y + 16);
  });
  y += 33;

  sectionTitle("Participacao por grupo de produto", "Distribuicao do valor faturado entre os grupos vendidos.");
  const pieGroups = dashboard.salesByGroup.slice(0, 7);
  const otherValue = dashboard.salesByGroup.slice(7).reduce((sum, item) => sum + Number(item.SALES_VALUE), 0);
  const chartGroups = otherValue > 0
    ? [...pieGroups, { CODGRUPOPROD: -1, DESCRGRUPOPROD: "OUTROS", SALES_VALUE: otherValue }]
    : pieGroups;
  const pie = salesGroupPie(chartGroups);
  if (pie) document.addImage(pie, "PNG", margin + 3, y, 55, 55, undefined, "FAST");
  const groupTotal = dashboard.salesByGroup.reduce((sum, item) => sum + Number(item.SALES_VALUE), 0);
  chartGroups.forEach((group, index) => {
    const legendY = y + 4 + index * 6.3;
    document.setFillColor(reportColors[index % reportColors.length]);
    document.circle(margin + 66, legendY - 1, 1.7, "F");
    document.setFont("helvetica", "bold");
    document.setFontSize(7);
    document.setTextColor(...ink);
    document.text(String(group.DESCRGRUPOPROD).slice(0, 30), margin + 70, legendY);
    const share = groupTotal ? (Number(group.SALES_VALUE) / groupTotal) * 100 : 0;
    document.setFont("helvetica", "normal");
    document.setTextColor(...muted);
    document.text(`${share.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%  ${money(Number(group.SALES_VALUE))}`, pageWidth - margin, legendY, { align: "right" });
  });
  y += 63;

  table(
    "Vendas por grupo de produto",
    ["Grupo", "Participacao", "Valor faturado"],
    [94, 38, 50],
    dashboard.salesByGroup.map((group) => [
      String(group.DESCRGRUPOPROD),
      `${(groupTotal ? Number(group.SALES_VALUE) / groupTotal * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
      money(Number(group.SALES_VALUE)),
    ]),
  );

  table(
    "Evolucao diaria das vendas",
    ["Data", "Pedidos", "Valor faturado"],
    [78, 54, 50],
    dashboard.dailySales.map((day) => [
      day.SALE_DATE,
      Number(day.ORDER_COUNT).toLocaleString("pt-BR"),
      money(Number(day.SALES_VALUE)),
    ]),
  );

  table(
    "Top 10 produtos mais vendidos",
    ["Produto", "Quantidade", "Valor faturado"],
    [104, 28, 50],
    products
      .slice()
      .sort((left, right) => Number(right.SALES_VALUE) - Number(left.SALES_VALUE))
      .slice(0, 10)
      .map((product) => [
        `${product.ENTITY_ID ?? product.CODPROD} - ${product.ENTITY_NAME ?? product.DESCRPROD}`,
        Number(product.QUANTITY || 0).toLocaleString("pt-BR"),
        money(Number(product.SALES_VALUE || 0)),
      ]),
  );

  table(
    "Clientes do periodo",
    ["Cliente", "Pedidos", "Valor faturado"],
    [104, 28, 50],
    clients
      .slice()
      .sort((left, right) => Number(right.SALES_VALUE) - Number(left.SALES_VALUE))
      .map((client) => [
        `${client.ENTITY_ID ?? client.CODPARC} - ${client.ENTITY_NAME ?? client.NOMEPARC}`,
        Number(client.ORDER_COUNT || 0).toLocaleString("pt-BR"),
        money(Number(client.SALES_VALUE || 0)),
      ]),
  );

  sectionTitle("Relacionamento comercial", "Resumo da carteira no periodo selecionado.");
  const portfolioRows = [
    ["Clientes novos", dashboard.clientPortfolio.NEW_CLIENTS],
    ["Clientes recorrentes", dashboard.clientPortfolio.RECURRING_CLIENTS],
    ["Clientes reativados", dashboard.clientPortfolio.REACTIVATED_CLIENTS],
    ["Sem comprar ha 30 dias", dashboard.clientPortfolio.INACTIVE_30],
    ["Sem comprar ha 60 dias", dashboard.clientPortfolio.INACTIVE_60],
    ["Sem comprar ha 90 dias", dashboard.clientPortfolio.INACTIVE_90],
  ];
  portfolioRows.forEach(([label, value], index) => {
    ensureSpace(10);
    const x = index % 2 === 0 ? margin : margin + contentWidth / 2 + 2;
    if (index % 2 === 0 && index > 0) y += 12;
    document.setFillColor(247, 250, 248);
    document.roundedRect(x, y, contentWidth / 2 - 2, 10, 2, 2, "F");
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.setTextColor(...muted);
    document.text(String(label), x + 4, y + 6.3);
    document.setFont("helvetica", "bold");
    document.setFontSize(10);
    document.setTextColor(...green);
    document.text(Number(value).toLocaleString("pt-BR"), x + contentWidth / 2 - 7, y + 6.5, { align: "right" });
  });

  const pageCount = document.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    document.setPage(page);
    document.setDrawColor(...line);
    document.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
    document.setFont("helvetica", "normal");
    document.setFontSize(7);
    document.setTextColor(...muted);
    document.text("Norte Sul Sementes - Relatorio comercial", margin, pageHeight - 6);
    document.text(`Pagina ${page} de ${pageCount}`, pageWidth - margin, pageHeight - 6, { align: "right" });
  }

  const fileSeller = sellerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  document.save(`relatorio-vendas-${fileSeller || "vendedor"}-${input.dateFrom}-a-${input.dateTo}.pdf`);
}

type DashboardPanelReport = "evolution" | "products" | "groups" | "clients" | "portfolio";

async function downloadDashboardPanelReport(input: {
  kind: DashboardPanelReport;
  dashboard: DashboardData;
  sellerName: string;
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
  rows?: ApiRow[];
  portfolioRows?: Array<{ segment: string; rows: ApiRow[] }>;
}) {
  const { jsPDF } = await import("jspdf");
  const { kind, dashboard, sellerName, periodLabel } = input;
  const titles: Record<DashboardPanelReport, string> = {
    evolution: "Evolucao das vendas",
    products: "Mix de vendas",
    groups: "Vendas por grupo de produto",
    clients: "Relacionamento com clientes",
    portfolio: "Carteira de clientes",
  };
  const fileNames: Record<DashboardPanelReport, string> = {
    evolution: "evolucao-vendas",
    products: "mix-vendas",
    groups: "grupos-produtos",
    clients: "clientes-periodo",
    portfolio: "carteira-clientes",
  };
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const green = [7, 122, 77] as const;
  const darkGreen = [8, 74, 49] as const;
  const ink = [26, 42, 34] as const;
  const muted = [103, 119, 110] as const;
  const line = [221, 231, 225] as const;
  let y = 62;

  const drawPageHeading = (firstPage = false) => {
    if (!firstPage) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(...green);
      pdf.text(`NORTE SUL SEMENTES - ${titles[kind].toUpperCase()}`, margin, 11);
      pdf.setDrawColor(...line);
      pdf.line(margin, 14, pageWidth - margin, 14);
      y = 21;
    }
  };
  const addPage = () => {
    pdf.addPage();
    drawPageHeading();
  };
  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - 16) addPage();
  };
  const section = (title: string, subtitle?: string) => {
    ensureSpace(subtitle ? 18 : 13);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(...ink);
    pdf.text(title, margin, y);
    y += 5;
    if (subtitle) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...muted);
      pdf.text(subtitle, margin, y);
      y += 5;
    }
    pdf.setDrawColor(...line);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 7;
  };
  const drawTable = (headers: string[], widths: number[], rows: Array<Array<string | number>>) => {
    const header = () => {
      ensureSpace(10);
      pdf.setFillColor(...darkGreen);
      pdf.roundedRect(margin, y, contentWidth, 8, 2, 2, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.setTextColor(255, 255, 255);
      let x = margin + 3;
      headers.forEach((label, index) => {
        pdf.text(label, index === headers.length - 1 ? x + widths[index] - 3 : x, y + 5.2, { align: index === headers.length - 1 ? "right" : "left" });
        x += widths[index];
      });
      y += 9;
    };
    header();
    rows.forEach((row, rowIndex) => {
      const wrapped = row.map((cell, index) => pdf.splitTextToSize(String(cell), Math.max(8, widths[index] - 6)) as string[]);
      const height = Math.max(8, Math.max(...wrapped.map((value) => value.length)) * 3.6 + 3);
      if (y + height > pageHeight - 16) {
        addPage();
        header();
      }
      if (rowIndex % 2 === 0) {
        pdf.setFillColor(247, 250, 248);
        pdf.rect(margin, y, contentWidth, height, "F");
      }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.2);
      pdf.setTextColor(...ink);
      let x = margin + 3;
      wrapped.forEach((cell, index) => {
        pdf.text(cell, index === wrapped.length - 1 ? x + widths[index] - 3 : x, y + 5, { align: index === wrapped.length - 1 ? "right" : "left" });
        x += widths[index];
      });
      pdf.setDrawColor(...line);
      pdf.line(margin, y + height, pageWidth - margin, y + height);
      y += height;
    });
    y += 7;
  };
  const metricCards = (cards: Array<[string, string]>) => {
    const gap = 4;
    const width = (contentWidth - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([label, value], index) => {
      const x = margin + index * (width + gap);
      pdf.setFillColor(237, 248, 242);
      pdf.roundedRect(x, y, width, 21, 3, 3, "F");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.setTextColor(...muted);
      pdf.text(label, x + 4, y + 7);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(value.length > 17 ? 9 : 12);
      pdf.setTextColor(...green);
      pdf.text(value, x + 4, y + 15.5);
    });
    y += 31;
  };

  pdf.setFillColor(...darkGreen);
  pdf.rect(0, 0, pageWidth, 50, "F");
  const logo = await imageDataUrl("/brand-logo.png").catch(() => "");
  if (logo) pdf.addImage(logo, "PNG", margin, 9, 25, 25, undefined, "FAST");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.setTextColor(255, 255, 255);
  pdf.text(titles[kind], logo ? 45 : margin, 19);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`Vendedor: ${sellerName}`, logo ? 45 : margin, 27);
  pdf.text(`Periodo: ${periodLabel}`, logo ? 45 : margin, 33);
  pdf.setFontSize(7);
  pdf.setTextColor(200, 231, 216);
  pdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, logo ? 45 : margin, 40);

  if (kind === "evolution") {
    metricCards([
      ["Faturamento", money(Number(dashboard.summary.SALES_VALUE))],
      ["Pedidos", Number(dashboard.summary.ORDER_COUNT).toLocaleString("pt-BR")],
      ["Dias com vendas", dashboard.dailySales.length.toLocaleString("pt-BR")],
    ]);
    section("Grafico vertical por dia", "Cada linha apresenta a data, os pedidos e o valor faturado sem abreviacoes.");
    const max = Math.max(...dashboard.dailySales.map((item) => Number(item.SALES_VALUE)), 1);
    dashboard.dailySales.forEach((day) => {
      ensureSpace(13);
      const barX = margin + 31;
      const barWidth = 91;
      const valueWidth = Math.max(2, Number(day.SALES_VALUE) / max * barWidth);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...ink);
      pdf.text(day.SALE_DATE, margin, y + 4.3);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.2);
      pdf.setTextColor(...muted);
      pdf.text(`${Number(day.ORDER_COUNT).toLocaleString("pt-BR")} ${Number(day.ORDER_COUNT) === 1 ? "pedido" : "pedidos"}`, margin, y + 8.2);
      pdf.setFillColor(232, 239, 235);
      pdf.roundedRect(barX, y + 1.5, barWidth, 7, 2, 2, "F");
      pdf.setFillColor(...green);
      pdf.roundedRect(barX, y + 1.5, valueWidth, 7, 2, 2, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...green);
      pdf.text(money(Number(day.SALES_VALUE)), pageWidth - margin, y + 5.8, { align: "right" });
      pdf.setDrawColor(...line);
      pdf.line(margin, y + 11, pageWidth - margin, y + 11);
      y += 12.5;
    });
    y += 5;
  }

  if (kind === "products") {
    const products = (input.rows ?? []).slice().sort((left, right) => Number(right.SALES_VALUE) - Number(left.SALES_VALUE));
    metricCards([
      ["Produtos vendidos", products.length.toLocaleString("pt-BR")],
      ["Unidades vendidas", products.reduce((sum, item) => sum + Number(item.QUANTITY || 0), 0).toLocaleString("pt-BR")],
      ["Valor total", money(products.reduce((sum, item) => sum + Number(item.SALES_VALUE || 0), 0))],
    ]);
    section("Lista completa de produtos vendidos", "Todos os produtos ordenados pelo valor faturado.");
    drawTable(["Produto", "Quantidade", "Valor faturado"], [104, 28, 50], products.map((product) => [`${product.ENTITY_ID ?? product.CODPROD} - ${product.ENTITY_NAME ?? product.DESCRPROD}`, Number(product.QUANTITY || 0).toLocaleString("pt-BR"), money(Number(product.SALES_VALUE || 0))]));
  }

  if (kind === "groups") {
    const groups = dashboard.salesByGroup.slice().sort((left, right) => Number(right.SALES_VALUE) - Number(left.SALES_VALUE));
    const total = groups.reduce((sum, item) => sum + Number(item.SALES_VALUE), 0);
    metricCards([
      ["Faturamento", money(total)],
      ["Grupos vendidos", groups.length.toLocaleString("pt-BR")],
      ["Maior grupo", groups[0]?.DESCRGRUPOPROD || "Sem vendas"],
    ]);
    section("Participacao por grupo", "Distribuicao percentual do faturamento.");
    const firstGroups = groups.slice(0, 7);
    const other = groups.slice(7).reduce((sum, item) => sum + Number(item.SALES_VALUE), 0);
    const chartGroups = other > 0 ? [...firstGroups, { CODGRUPOPROD: -1, DESCRGRUPOPROD: "OUTROS", SALES_VALUE: other }] : firstGroups;
    const pie = salesGroupPie(chartGroups);
    if (pie) pdf.addImage(pie, "PNG", margin + 4, y, 54, 54, undefined, "FAST");
    chartGroups.forEach((group, index) => {
      const legendY = y + 4 + index * 6.2;
      pdf.setFillColor(reportColors[index % reportColors.length]);
      pdf.circle(margin + 66, legendY - 1, 1.7, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.setTextColor(...ink);
      pdf.text(String(group.DESCRGRUPOPROD).slice(0, 27), margin + 70, legendY);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...muted);
      pdf.text(`${(total ? Number(group.SALES_VALUE) / total * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, pageWidth - margin, legendY, { align: "right" });
    });
    y += 62;
    drawTable(["Grupo", "Participacao", "Valor faturado"], [94, 38, 50], groups.map((group) => [group.DESCRGRUPOPROD, `${(total ? Number(group.SALES_VALUE) / total * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, money(Number(group.SALES_VALUE))]));
  }

  if (kind === "clients") {
    const clients = (input.rows ?? []).slice().sort((left, right) => Number(right.SALES_VALUE) - Number(left.SALES_VALUE));
    metricCards([
      ["Clientes atendidos", clients.length.toLocaleString("pt-BR")],
      ["Pedidos", clients.reduce((sum, item) => sum + Number(item.ORDER_COUNT || 0), 0).toLocaleString("pt-BR")],
      ["Valor faturado", money(clients.reduce((sum, item) => sum + Number(item.SALES_VALUE || 0), 0))],
    ]);
    section("Clientes do periodo", "Relacionamento ordenado pelo valor faturado.");
    drawTable(["Cliente", "Pedidos", "Valor faturado"], [104, 28, 50], clients.map((client) => [`${client.ENTITY_ID ?? client.CODPARC} - ${client.ENTITY_NAME ?? client.NOMEPARC}`, Number(client.ORDER_COUNT || 0).toLocaleString("pt-BR"), money(Number(client.SALES_VALUE || 0))]));
  }

  if (kind === "portfolio") {
    metricCards([
      ["Novos", Number(dashboard.clientPortfolio.NEW_CLIENTS).toLocaleString("pt-BR")],
      ["Recorrentes", Number(dashboard.clientPortfolio.RECURRING_CLIENTS).toLocaleString("pt-BR")],
      ["Reativados", Number(dashboard.clientPortfolio.REACTIVATED_CLIENTS).toLocaleString("pt-BR")],
      ["Atencao 30+", Number(dashboard.clientPortfolio.INACTIVE_30).toLocaleString("pt-BR")],
    ]);
    const portfolioRows = input.portfolioRows ?? [];
    if (!portfolioRows.some((segment) => segment.rows.length)) {
      section("Resumo da carteira", "Os indicadores acima representam os dados disponiveis neste aparelho.");
    }
    portfolioRows.forEach((segment) => {
      if (!segment.rows.length) return;
      section(segment.segment, `${segment.rows.length} clientes neste segmento.`);
      drawTable(["Cliente", "Data de referencia", "Informacao"], [106, 38, 38], segment.rows.map((client) => [
        `${client.ENTITY_ID} - ${client.ENTITY_NAME}`,
        String(client.REFERENCE_DATE || client.LAST_PURCHASE || "Sem compra"),
        client.DAYS_WITHOUT_PURCHASE != null ? `${Number(client.DAYS_WITHOUT_PURCHASE).toLocaleString("pt-BR")} dias` : `${Number(client.ORDER_COUNT || 0).toLocaleString("pt-BR")} pedidos`,
      ]));
    });
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...line);
    pdf.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...muted);
    pdf.text(`Norte Sul Sementes - ${titles[kind]}`, margin, pageHeight - 6);
    pdf.text(`Pagina ${page} de ${pages}`, pageWidth - margin, pageHeight - 6, { align: "right" });
  }
  const sellerFile = sellerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  pdf.save(`relatorio-${fileNames[kind]}-${sellerFile || "vendedor"}-${input.dateFrom}-a-${input.dateTo}.pdf`);
}

const normalizeProductSearch = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const sankhyaDate = (value: unknown) => {
  const raw = String(value ?? "");
  if (/^\d{8}/.test(raw)) return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`;
  return raw || "Hoje";
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: ({ error?: string } & T);
  try {
    data = JSON.parse(text) as ({ error?: string } & T);
  } catch {
    throw new Error(
      response.ok
        ? "O servidor retornou uma resposta inválida."
        : "O servidor não conseguiu concluir a solicitação. Reinicie o app e tente novamente.",
    );
  }
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data as T;
}

function decodeVapidPublicKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function registerPushNotifications() {
  if (
    !window.isSecureContext
    || !("serviceWorker" in navigator)
    || !("PushManager" in window)
    || !("Notification" in window)
    || Notification.permission !== "granted"
  ) return false;

  const { publicKey } = await api<{ publicKey: string }>("/api/chat/push");
  if (!publicKey) return false;
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const subscription = current || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidPublicKey(publicKey),
  });
  await api("/api/chat/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return true;
}

async function unregisterPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  if (navigator.onLine) {
    await api("/api/chat/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => null);
  }
  await subscription.unsubscribe();
}

export function SalesApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState("Leonardo");
  const [userId, setUserId] = useState(0);
  const [sellerId, setSellerId] = useState(0);
  const [sellerName, setSellerName] = useState("");
  const [screen, setScreen] = useState<AppScreen>("home");
  const [orders, setOrders] = useState<ApiRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [offlineData, setOfflineData] = useState<OfflineSnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosDevice, setIosDevice] = useState(false);
  const [secureContext, setSecureContext] = useState(true);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [startingPartner, setStartingPartner] = useState<Partner | null>(null);
  const [activeDraft, setActiveDraft] = useState<OrderDraft | null>(null);
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);
  const [toast, setToast] = useState("");
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [canMonitorSales, setCanMonitorSales] = useState(false);

  const applySnapshot = (snapshot: OfflineSnapshot, replaceOrders = true) => {
    setOfflineData(snapshot);
    setUser(snapshot.seller.user);
    setUserId(snapshot.seller.userId);
    setSellerId(snapshot.seller.sellerId);
    setSellerName(snapshot.seller.sellerName);
    setClients(snapshot.clients as Client[]);
    if (replaceOrders) setOrders(filterOrdersByPeriod(snapshot.orders, currentMonthStart(), inputDate(new Date())));
    setAuthenticated(true);
  };

  const pushHistoryView = (view: AppHistoryView, baseScreen?: Exclude<AppScreen, "new">) => {
    const state: AppHistoryState = { norteSulVendas: true, view, baseScreen };
    window.history.pushState(state, "", window.location.href);
  };

  const replaceHistoryView = (view: AppHistoryView, baseScreen?: Exclude<AppScreen, "new">) => {
    const state: AppHistoryState = { norteSulVendas: true, view, baseScreen };
    window.history.replaceState(state, "", window.location.href);
  };

  const navigateTo = (nextScreen: Exclude<AppScreen, "new">) => {
    if (screen === nextScreen && !clientPickerOpen && !logoutConfirmOpen) return;
    pushHistoryView(nextScreen);
    setClientPickerOpen(false);
    setLogoutConfirmOpen(false);
    setScreen(nextScreen);
  };

  const openCommunication = () => {
    navigateTo("communication");
    const mobileDevice = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!mobileDevice || !window.isSecureContext || !("Notification" in window)) return;
    void (async () => {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") await registerPushNotifications();
    })().catch(() => null);
  };

  useEffect(() => {
    setUnreadMessages(0);
  }, [userId]);

  useEffect(() => {
    if (!authenticated || !userId) return;
    const permissionKey = `norte-sul-vendas:general-sales:${userId}`;
    if (!online) {
      setCanMonitorSales(localStorage.getItem(permissionKey) === "true");
      return;
    }
    let cancelled = false;
    api<{ rows: DashboardSeller[] }>("/api/sankhya/data?kind=dashboardSellers")
      .then(() => {
        if (cancelled) return;
        setCanMonitorSales(true);
        localStorage.setItem(permissionKey, "true");
      })
      .catch(() => {
        if (cancelled) return;
        setCanMonitorSales(false);
        localStorage.removeItem(permissionKey);
        if (screen === "general-sales") navigateTo("home");
      });
    return () => { cancelled = true; };
  }, [authenticated, online, userId]);

  useEffect(() => {
    if (
      authenticated
      && /android|iphone|ipad|ipod/i.test(navigator.userAgent)
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      void registerPushNotifications().catch(() => null);
    }
  }, [authenticated, userId]);

  useEffect(() => {
    if (!authenticated || !online || !userId) return;
    let cancelled = false;
    const refreshUnreadMessages = async () => {
      try {
        const result = await api<{ rows: ChatConversation[] }>("/api/chat/conversations");
        if (cancelled) return;
        const total = result.rows.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
        setUnreadMessages(total);
      } catch {
        // O contador é auxiliar e não deve interromper o restante do aplicativo.
      }
    };
    void refreshUnreadMessages();
    const timer = window.setInterval(() => void refreshUnreadMessages(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authenticated, online, userId]);

  const loadOrders = async (dateFrom = currentMonthStart(), dateTo = inputDate(new Date())) => {
    setLoadingOrders(true);
    try {
      const params = new URLSearchParams({ kind: "orders" });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const result = await api<{ rows: ApiRow[]; user?: string; userId?: number; sellerId?: number; sellerName?: string }>(`/api/sankhya/data?${params}`);
      setOrders(result.rows);
      if (result.user) setUser(result.user);
      if (result.userId) setUserId(Number(result.userId));
      if (result.sellerId) setSellerId(Number(result.sellerId));
      if (result.sellerName) setSellerName(String(result.sellerName));
      setAuthenticated(true);
    } catch (error) {
      const cached = offlineData
        ?? (sellerId ? await getOfflineSnapshot(sellerId) : await getLatestOfflineSnapshot());
      if (cached) {
        applySnapshot(cached, false);
        setOrders(filterOrdersByPeriod(cached.orders, dateFrom, dateTo));
        setToast("Exibindo os pedidos da última carga salva neste aparelho.");
      } else {
        setAuthenticated(false);
        setToast(error instanceof Error ? error.message : "Não foi possível carregar os pedidos.");
      }
    } finally {
      setLoadingOrders(false);
      setCheckingSession(false);
    }
  };

  const showOrders = () => {
    navigateTo("orders");
    void loadOrders();
  };

  const makeLoad = async (showSuccess = true) => {
    if (!navigator.onLine) {
      setToast("Conecte-se à internet para fazer uma nova carga.");
      return null;
    }
    setSyncing(true);
    try {
      const snapshot = await api<OfflineSnapshot>("/api/sankhya/sync");
      await saveOfflineSnapshot(snapshot);
      localStorage.setItem(OFFLINE_SESSION_KEY, "true");
      applySnapshot(snapshot);
      if (showSuccess) {
        setToast(`Carga concluída: ${snapshot.clients.length} clientes e ${snapshot.products.length} saldos de produtos.`);
      }
      return snapshot;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível fazer a carga.");
      return null;
    } finally {
      setSyncing(false);
    }
  };

  const installApplication = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setToast("Aplicativo instalado com sucesso.");
    setInstallPrompt(null);
  };

  const loadPortfolio = async () => {
    if (clients.length) return clients;
    setLoadingClients(true);
    try {
      const result = await api<{ rows: Client[] }>("/api/sankhya/data?kind=portfolio");
      setClients(result.rows);
      return result.rows;
    } catch (error) {
      const cached = offlineData
        ?? (sellerId ? await getOfflineSnapshot(sellerId) : await getLatestOfflineSnapshot());
      if (cached) {
        setOfflineData(cached);
        setClients(cached.clients as Client[]);
        return cached.clients as Client[];
      }
      setToast(error instanceof Error ? error.message : "Não foi possível carregar a carteira.");
      return [];
    } finally {
      setLoadingClients(false);
    }
  };

  const showClients = async () => {
    navigateTo("clients");
    await loadPortfolio();
  };

  const openNewOrder = async () => {
    pushHistoryView("client-picker", screen === "new" ? "orders" : screen);
    setClientPickerOpen(true);
    await loadPortfolio();
  };

  const draftKey = sellerId ? `norte-sul-vendas:drafts:${sellerId}` : "";

  useEffect(() => {
    if (!draftKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey) || "[]") as OrderDraft[];
      setDrafts(Array.isArray(stored) ? stored : []);
    } catch {
      setDrafts([]);
    }
  }, [draftKey]);

  const saveDraft = (draft: OrderDraft) => {
    setDrafts((current) => {
      const next = [draft, ...current.filter((item) => item.id !== draft.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (draftKey) localStorage.setItem(draftKey, JSON.stringify(next));
      return next;
    });
  };

  const removeDraft = (id: string) => {
    setDrafts((current) => {
      const next = current.filter((draft) => draft.id !== id);
      if (draftKey) localStorage.setItem(draftKey, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const notificationTarget = new URLSearchParams(window.location.search).get("open");
    if (notificationTarget === "communication") {
      window.history.replaceState(
        { norteSulVendas: true, view: "communication" } satisfies AppHistoryState,
        "",
        window.location.pathname,
      );
      setScreen("communication");
    } else {
      replaceHistoryView("home");
    }
    const handleHistoryBack = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;
      const view = state?.norteSulVendas ? state.view : "home";
      setLogoutConfirmOpen(view === "logout");
      setClientPickerOpen(view === "client-picker");

      if (view === "client-picker" || view === "logout") {
        setScreen(state?.baseScreen ?? "home");
        return;
      }

      setScreen(view);
      if (view !== "new") {
        setActiveDraft(null);
        setStartingPartner(null);
      }
    };
    const updateConnection = () => setOnline(navigator.onLine);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    setIosDevice(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setSecureContext(window.isSecureContext);
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    const openCommunicationFromNotification = (event: MessageEvent) => {
      if (event.data?.type !== "OPEN_COMMUNICATION") return;
      pushHistoryView("communication");
      setScreen("communication");
    };
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("popstate", handleHistoryBack);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    navigator.serviceWorker?.addEventListener("message", openCommunicationFromNotification);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => null);
    navigator.storage?.persist?.().catch(() => false);

    const bootstrap = async () => {
      try {
        const result = await api<{ rows: ApiRow[]; user?: string; userId?: number; sellerId?: number; sellerName?: string }>(
          "/api/sankhya/data?kind=orders",
        );
        setOrders(result.rows);
        setUser(result.user || "");
        setUserId(Number(result.userId || 0));
        setSellerId(Number(result.sellerId || 0));
        setSellerName(result.sellerName || result.user || "");
        setAuthenticated(true);
        localStorage.setItem(OFFLINE_SESSION_KEY, "true");
        setCheckingSession(false);
        void makeLoad(false);
      } catch {
        const offlineEnabled = localStorage.getItem(OFFLINE_SESSION_KEY) === "true";
        const cached = offlineEnabled ? await getLatestOfflineSnapshot().catch(() => null) : null;
        if (cached) applySnapshot(cached);
        setCheckingSession(false);
      }
    };
    void bootstrap();
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("popstate", handleHistoryBack);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
      navigator.serviceWorker?.removeEventListener("message", openCommunicationFromNotification);
    };
  }, []);

  const requestLogout = () => {
    if (logoutConfirmOpen) return;
    pushHistoryView("logout", screen === "new" ? "orders" : screen);
    setLogoutConfirmOpen(true);
  };

  const closeLogoutConfirmation = () => {
    if (logoutConfirmOpen) window.history.back();
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await unregisterPushNotifications().catch(() => null);
      if (navigator.onLine) await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
      localStorage.setItem(OFFLINE_SESSION_KEY, "false");
      setAuthenticated(false);
      setUnreadMessages(0);
      setCanMonitorSales(false);
      setScreen("home");
      setLogoutConfirmOpen(false);
      replaceHistoryView("home");
    } finally {
      setLoggingOut(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="app-loader">
        <BrandMark />
        <LoaderCircle className="spin" size={26} />
        <span>Conectando ao Sankhya...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginScreen
        onLogin={(loginData) => {
          setUser(loginData.user);
          setUserId(loginData.userId);
          setSellerId(loginData.sellerId);
          setSellerName(loginData.sellerName);
          setAuthenticated(true);
          setScreen("home");
          replaceHistoryView("home");
          localStorage.setItem(OFFLINE_SESSION_KEY, "true");
          void makeLoad();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <DesktopSidebar
        active={screen}
        user={user}
        onHome={() => navigateTo("home")}
        canMonitorSales={canMonitorSales}
        onGeneralSales={() => navigateTo("general-sales")}
        onOrders={showOrders}
        onClients={showClients}
        onCommunication={openCommunication}
        unreadMessages={unreadMessages}
        onMore={() => navigateTo("more")}
        onLogout={requestLogout}
      />
      <main className="main-shell">
        {screen === "home" ? (
          <HomeScreen sellerId={sellerId} sellerName={sellerName || user} online={online} />
        ) : screen === "general-sales" ? (
          canMonitorSales
            ? <GeneralSalesScreen online={online} />
            : <HomeScreen sellerId={sellerId} sellerName={sellerName || user} online={online} />
        ) : screen === "orders" ? (
          <OrdersScreen
            orders={orders}
            loading={loadingOrders}
            drafts={drafts}
            onNew={openNewOrder}
            onResume={(draft) => {
              setActiveDraft(draft);
              setStartingPartner(draft.partner);
              pushHistoryView("new");
              setScreen("new");
            }}
            onPeriodChange={loadOrders}
          />
        ) : screen === "clients" ? (
          <ClientsScreen clients={clients} loading={loadingClients} />
        ) : screen === "communication" ? (
          <CommunicationScreen currentUserId={userId} currentUserName={user} online={online} />
        ) : screen === "more" ? (
          <MoreScreen
            user={user}
            sellerId={sellerId}
            sellerName={sellerName}
            online={online}
            syncing={syncing}
            snapshot={offlineData}
            canInstall={Boolean(installPrompt)}
            installed={installed}
            iosDevice={iosDevice}
            secureContext={secureContext}
            onInstall={() => void installApplication()}
            onLoad={() => void makeLoad()}
            onLogout={requestLogout}
          />
        ) : (
          <NewOrderV2
            partner={startingPartner!}
            draft={activeDraft}
            offlineData={offlineData}
            online={online}
            onSaveDraft={saveDraft}
            onBack={() => {
              window.history.back();
            }}
            onSent={(id, draftId) => {
              removeDraft(draftId);
              setToast(`Pedido ${id || ""} enviado ao Sankhya com sucesso.`);
              replaceHistoryView("orders");
              setScreen("orders");
              setActiveDraft(null);
              setStartingPartner(null);
              loadOrders();
            }}
          />
        )}
      </main>
      {screen !== "new" && (
        <MobileNav
          active={screen}
          onHome={() => navigateTo("home")}
          canMonitorSales={canMonitorSales}
          onGeneralSales={() => navigateTo("general-sales")}
          onOrders={showOrders}
          onClients={showClients}
          onCommunication={openCommunication}
          unreadMessages={unreadMessages}
          onMore={() => navigateTo("more")}
        />
      )}
      {clientPickerOpen && (
        <ClientPickerModal
          clients={clients}
          loading={loadingClients}
          onClose={() => window.history.back()}
          onSelect={(client) => {
            setStartingPartner(client);
            setActiveDraft(null);
            setClientPickerOpen(false);
            replaceHistoryView("new");
            setScreen("new");
          }}
        />
      )}
      {logoutConfirmOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar saída">
          <div className="confirm-modal logout-confirm-modal">
            <button className="modal-close" onClick={closeLogoutConfirmation} aria-label="Fechar"><X size={20} /></button>
            <span className="confirm-icon logout-icon"><LogOut size={27} /></span>
            <h2>Deseja sair do aplicativo?</h2>
            <p>Será necessário informar novamente suas credenciais para fazer carga ou enviar pedidos. Seus dados offline e rascunhos continuarão salvos neste aparelho.</p>
            <div className="modal-actions">
              <button className="secondary" onClick={closeLogoutConfirmation} disabled={loggingOut}>Cancelar</button>
              <button className="primary logout-action" onClick={logout} disabled={loggingOut}>
                {loggingOut ? <LoaderCircle className="spin" size={18} /> : <><LogOut size={18} /> Sim, sair</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <button className="toast" onClick={() => setToast("")}>
          <CheckCircle2 size={20} />
          {toast}
          <X size={17} />
        </button>
      )}
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <span className="brand-mark">
        <img src="/brand-logo.png" alt={compact ? "Norte Sul" : ""} />
      </span>
      {!compact && (
        <span><strong>Norte Sul</strong><small>Força de vendas</small></span>
      )}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (data: { user: string; userId: number; sellerId: number; sellerName: string }) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ user: string; userId: number; sellerId: number; sellerName: string }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      onLogin({
        user: result.user || username,
        userId: Number(result.userId),
        sellerId: Number(result.sellerId),
        sellerName: result.sellerName || result.user || username,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story">
        <BrandMark />
        <div className="story-copy">
          <span className="eyebrow light"><Wifi size={15} /> Conectado ao seu ERP</span>
          <h1>Vendas no campo.<br />Gestão em tempo real.</h1>
          <p>Crie pedidos com preços, estoque e regras comerciais sincronizados com o Sankhya.</p>
        </div>
        <div className="login-benefits">
          <span><ShieldCheck size={19} /> Regras comerciais validadas</span>
          <span><PackageCheck size={19} /> Estoque disponível em tempo real</span>
          <span><CloudCheck size={19} /> Envio direto para o Sankhya</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-mobile-brand"><BrandMark /></div>
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">Acesso seguro</span>
          <h2>Bem-vindo de volta</h2>
          <p>Use as mesmas credenciais do Sankhya.</p>
          <label>
            Usuário
            <span className="field">
              <UserRound size={19} />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Seu usuário Sankhya"
                autoComplete="username"
                required
              />
            </span>
          </label>
          <label>
            Senha
            <span className="field">
              <LockKeyhole size={19} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="Sua senha"
                autoComplete="current-password"
                required
              />
            </span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary large" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={20} /> : <>Entrar <ArrowRight size={19} /></>}
          </button>
          <div className="security-note"><ShieldCheck size={16} /> Suas credenciais não ficam salvas neste dispositivo.</div>
        </form>
      </section>
    </main>
  );
}

function DesktopSidebar({
  active,
  user,
  onHome,
  canMonitorSales,
  onGeneralSales,
  onOrders,
  onClients,
  onCommunication,
  unreadMessages,
  onMore,
  onLogout,
}: {
  active: string;
  user: string;
  onHome: () => void;
  canMonitorSales: boolean;
  onGeneralSales: () => void;
  onOrders: () => void;
  onClients: () => void;
  onCommunication: () => void;
  unreadMessages: number;
  onMore: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="desktop-sidebar">
      <BrandMark />
      <nav>
        <button className={active === "home" ? "active" : ""} onClick={onHome}><Home size={20} /> Visão geral</button>
        {canMonitorSales && (
          <button className={active === "general-sales" ? "active" : ""} onClick={onGeneralSales}>
            <CircleDollarSign size={20} /> Vendas gerais
          </button>
        )}
        <button className={active === "orders" || active === "new" ? "active" : ""} onClick={onOrders}>
          <ShoppingBag size={20} /> Pedidos
        </button>
        <button className={active === "clients" ? "active" : ""} onClick={onClients}><UsersRound size={20} /> Clientes</button>
        <button className={active === "communication" ? "active" : ""} onClick={onCommunication}>
          <MessageCircle size={20} /> Comunicação
          {unreadMessages > 0 && <span className="nav-unread-badge">{unreadMessages}</span>}
        </button>
        <button className={active === "more" ? "active" : ""} onClick={onMore}><Menu size={20} /> Mais</button>
      </nav>
      <div className="sidebar-user">
        <span className="avatar">{user.charAt(0).toUpperCase()}</span>
        <span><strong>{user}</strong><small>Vendedor</small></span>
        <button onClick={onLogout} aria-label="Sair"><LogOut size={18} /></button>
      </div>
    </aside>
  );
}

function MonthlySalesChart({ rows }: { rows: GeneralSalesData["monthly"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows.length) return;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const width = bounds.width;
      const height = bounds.height;
      const padding = { left: width < 520 ? 46 : 62, right: 18, top: 34, bottom: 42 };
      const chartWidth = Math.max(1, width - padding.left - padding.right);
      const chartHeight = Math.max(1, height - padding.top - padding.bottom);
      const maximum = Math.max(...rows.map((item) => Number(item.SALES_VALUE)), 1);
      const points = rows.map((item, index) => ({
        x: padding.left + (rows.length === 1 ? chartWidth / 2 : (index / (rows.length - 1)) * chartWidth),
        y: padding.top + chartHeight - (Number(item.SALES_VALUE) / maximum) * chartHeight,
        item,
      }));
      context.clearRect(0, 0, width, height);
      context.font = "10px Manrope, Arial";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let line = 0; line <= 4; line += 1) {
        const y = padding.top + (line / 4) * chartHeight;
        context.strokeStyle = "#e4ebe7";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = "#697870";
        context.fillText(compactMoney(maximum * (1 - line / 4)), padding.left - 8, y);
      }
      const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
      gradient.addColorStop(0, "rgba(8, 132, 84, .27)");
      gradient.addColorStop(1, "rgba(8, 132, 84, .03)");
      context.beginPath();
      context.moveTo(points[0].x, padding.top + chartHeight);
      points.forEach((point) => context.lineTo(point.x, point.y));
      context.lineTo(points[points.length - 1].x, padding.top + chartHeight);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.strokeStyle = "#078454";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.stroke();
      const labelInterval = width < 520 ? Math.ceil(rows.length / 5) : 1;
      points.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        context.fillStyle = "white";
        context.fill();
        context.strokeStyle = "#078454";
        context.lineWidth = 2.5;
        context.stroke();
        if (index % labelInterval === 0 || index === points.length - 1) {
          context.fillStyle = "#26372f";
          context.font = "700 9px Manrope, Arial";
          context.textAlign = "center";
          context.fillText(compactMoney(Number(point.item.SALES_VALUE)), point.x, Math.max(13, point.y - 14));
          context.fillStyle = "#697870";
          context.font = "9px Manrope, Arial";
          context.fillText(point.item.SALE_MONTH, point.x, height - 17);
        }
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rows]);

  if (!rows.length) return <div className="dashboard-empty">Sem vendas mensais no período.</div>;
  return <canvas ref={canvasRef} className="general-line-chart" role="img" aria-label="Gráfico da evolução mensal do faturamento" />;
}

function GeneralSalesScreen({ online }: { online: boolean }) {
  const today = new Date();
  const yearStart = inputDate(new Date(today.getFullYear(), 0, 1));
  const todayValue = inputDate(today);
  const [companies, setCompanies] = useState<GeneralSalesCompany[]>([]);
  const [company, setCompany] = useState(0);
  const [dateFrom, setDateFrom] = useState(yearStart);
  const [dateTo, setDateTo] = useState(todayValue);
  const [applied, setApplied] = useState({ from: yearStart, to: todayValue, company: 0 });
  const [data, setData] = useState<GeneralSalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const cacheKey = `norte-sul-vendas:general-sales:v3:${applied.company}:${applied.from}:${applied.to}`;

  useEffect(() => {
    if (!online) return;
    api<{ rows: GeneralSalesCompany[] }>("/api/sankhya/data?kind=generalSalesCompanies")
      .then((result) => setCompanies(result.rows))
      .catch(() => setCompanies([]));
  }, [online]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setNotice("");
      try {
        if (!online) throw new Error("OFFLINE");
        const params = new URLSearchParams({
          kind: "generalSales",
          dateFrom: applied.from,
          dateTo: applied.to,
        });
        if (applied.company) params.set("company", String(applied.company));
        const result = await api<GeneralSalesData>(`/api/sankhya/data?${params}`);
        if (cancelled) return;
        setData(result);
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as GeneralSalesData | null;
        if (cancelled) return;
        if (cached) {
          setData(cached);
          setNotice("Exibindo o último monitoramento salvo neste aparelho.");
        } else {
          setData(null);
          setNotice(online ? "Não foi possível carregar o monitoramento geral." : "Conecte-se para carregar este monitoramento pela primeira vez.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [applied, cacheKey, online]);

  const selectPeriod = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setApplied({ from, to, company });
  };
  const monthStart = currentMonthStart();
  const twelveMonthsStart = inputDate(new Date(today.getFullYear(), today.getMonth() - 11, 1));
  const maxGroup = Math.max(...(data?.groups.map((item) => Number(item.SALES_VALUE)) ?? [0]), 1);
  const groupTotal = data?.groups.reduce((sum, item) => sum + Number(item.SALES_VALUE), 0) ?? 0;
  const formatPeriod = (value: string) => value.split("-").reverse().join("/");
  const confirmedOrders = Number(data?.summary.ORDER_COUNT || 0);
  const openOrders = Number(data?.summary.OPEN_ORDER_COUNT || 0);
  const totalOrders = confirmedOrders + openOrders;

  return (
    <div className="page dashboard-page general-sales-page">
      <header className="mobile-header dashboard-mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Vendas gerais</h1><p>Monitoramento das empresas</p></div>
        <span className={`connection-dot ${online ? "" : "offline"}`} />
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Gestão comercial</span><h1>Vendas gerais</h1><p>Desempenho consolidado e separado por empresa.</p></div>
        <span className="sync-badge"><CloudCheck size={15} /> {online ? "Dados do Sankhya" : "Dados salvos"}</span>
      </header>

      <section className="general-sales-filter" aria-label="Filtros do monitoramento geral">
        <div className="dashboard-period-title"><CalendarDays size={19} /><span><strong>Período analisado</strong><small>{formatPeriod(applied.from)} a {formatPeriod(applied.to)}</small></span></div>
        <div className="dashboard-period-presets">
          <button onClick={() => selectPeriod(monthStart, todayValue)}>Este mês</button>
          <button className={applied.from === yearStart && applied.to === todayValue ? "active" : ""} onClick={() => selectPeriod(yearStart, todayValue)}>Este ano</button>
          <button onClick={() => selectPeriod(twelveMonthsStart, todayValue)}>Últimos 12 meses</button>
        </div>
        <label>Empresa<select value={company} onChange={(event) => setCompany(Number(event.target.value))}><option value={0}>Todas as empresas</option>{companies.map((item) => <option key={item.CODEMP} value={item.CODEMP}>{item.CODEMP} — {item.NOMEFANTASIA}</option>)}</select></label>
        <label>De<input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Até<input type="date" value={dateTo} min={dateFrom} max={todayValue} onChange={(event) => setDateTo(event.target.value)} /></label>
        <button className="primary dashboard-period-apply" onClick={() => setApplied({ from: dateFrom, to: dateTo, company })}><Filter size={15} /> Aplicar</button>
      </section>

      {notice && <div className="dashboard-notice"><CloudOff size={16} /> {notice}</div>}
      {loading ? (
        <div className="dashboard-loading"><LoaderCircle className="spin" /><span>Consolidando as vendas...</span></div>
      ) : data ? (
        <>
          <p className="general-updated"><span /> Dados atualizados conforme o período selecionado</p>
          <section className="general-kpis">
            <article className="dashboard-kpi general-kpi sales"><span><CircleDollarSign /></span><div><small>Vendas no período</small><strong>{money(Number(data.summary.SALES_VALUE))}</strong><em>{totalOrders.toLocaleString("pt-BR")} pedidos no total</em></div></article>
            <article className="dashboard-kpi general-kpi ticket"><span><ClipboardList /></span><div><small>Ticket médio</small><strong>{money(Number(data.summary.AVG_TICKET))}</strong><em>por pedido faturado</em></div></article>
            <article className="dashboard-kpi general-kpi clients"><span><UsersRound /></span><div><small>Clientes atendidos</small><strong>{Number(data.summary.CLIENT_COUNT).toLocaleString("pt-BR")}</strong><em>{Number(data.summary.SELLER_COUNT).toLocaleString("pt-BR")} vendedores</em></div></article>
            <article className="dashboard-kpi general-kpi orders"><span><PackageCheck /></span><div><small>Pedidos faturados</small><strong>{confirmedOrders.toLocaleString("pt-BR")}</strong><em>{totalOrders ? ((confirmedOrders / totalOrders) * 100).toFixed(1).replace(".", ",") : "0,0"}% do total</em></div></article>
          </section>

          <section className="general-monitor-grid">
            <article className="dashboard-card general-monthly-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Evolução</span><h2>Vendas por mês</h2></div><span className="general-legend"><i /> Valor vendido</span></div>
              <MonthlySalesChart rows={data.monthly} />
            </article>

            <article className="dashboard-card general-pipeline-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Pipeline</span><h2>Status dos pedidos</h2></div></div>
              <div className="general-pipeline-content">
                <div className="general-donut" style={{ background: `conic-gradient(#078454 0 ${totalOrders ? (confirmedOrders / totalOrders) * 360 : 0}deg, #efa85d 0 360deg)` }}>
                  <span><strong>{totalOrders.toLocaleString("pt-BR")}</strong><small>pedidos</small></span>
                </div>
                <div className="pipeline-legend">
                  <div><i className="confirmed" /><span>Faturados</span><strong>{confirmedOrders.toLocaleString("pt-BR")}</strong></div>
                  <div><i className="open" /><span>Em aberto</span><strong>{openOrders.toLocaleString("pt-BR")}</strong></div>
                  <small>{money(Number(data.summary.OPEN_VALUE))} aguardando faturamento</small>
                </div>
              </div>
            </article>

            <article className="dashboard-card general-seller-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Desempenho</span><h2>Ranking de vendedores</h2></div><span className="general-card-tag">Top 10</span></div>
              <div className="general-seller-ranking general-ranking-scroll">
                {data.sellers.slice(0, 10).map((item, index) => <div className="general-seller-row" key={item.CODVEND}><b className={index < 3 ? `podium podium-${index + 1}` : ""}>{index + 1}</b><div><strong>{item.APELIDO}</strong><small>{Number(item.ORDER_COUNT)} pedidos · ticket {money(Number(item.AVG_TICKET))}</small></div><em>{compactMoney(Number(item.SALES_VALUE))}</em></div>)}
                {!data.sellers.length && <div className="dashboard-empty">Nenhum vendedor com vendas.</div>}
              </div>
            </article>

            <article className="dashboard-card general-group-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Mix de produtos</span><h2>Grupos mais vendidos</h2></div><span className="general-card-tag">Por valor</span></div>
              <div className="general-group-ranking general-ranking-scroll">
                {data.groups.slice(0, 10).map((item) => <div className="general-group-row" key={item.CODGRUPOPROD}><div><strong>{item.DESCRGRUPOPROD}</strong><em>{compactMoney(Number(item.SALES_VALUE))}</em></div><small>{groupTotal ? ((Number(item.SALES_VALUE) / groupTotal) * 100).toFixed(1).replace(".", ",") : "0,0"}% de participação</small><span><i style={{ width: `${(Number(item.SALES_VALUE) / maxGroup) * 100}%` }} /></span></div>)}
                {!data.groups.length && <div className="dashboard-empty">Nenhum grupo vendido no período.</div>}
              </div>
            </article>

            <article className="dashboard-card general-company-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Comparativo</span><h2>Desempenho por empresa</h2></div><Building2 /></div>
              <div className="general-company-table-wrap">
                <div className="general-company-table general-company-head"><span>Empresa</span><span>Pedidos</span><span>Clientes</span><span>Ticket médio</span><span>Vendas</span><span>Participação</span></div>
                {data.companies.map((item) => {
                  const participation = data.summary.SALES_VALUE ? (Number(item.SALES_VALUE) / Number(data.summary.SALES_VALUE)) * 100 : 0;
                  return <div className="general-company-table general-company-row" key={item.CODEMP}><div className="general-company-name"><b>{String(item.NOMEFANTASIA || "E").charAt(0)}</b><strong>{item.CODEMP} - {item.NOMEFANTASIA}</strong></div><span data-label="Pedidos">{Number(item.ORDER_COUNT).toLocaleString("pt-BR")}</span><span data-label="Clientes">{Number(item.CLIENT_COUNT).toLocaleString("pt-BR")}</span><span data-label="Ticket médio">{money(Number(item.AVG_TICKET))}</span><span data-label="Vendas">{money(Number(item.SALES_VALUE))}</span><span className="company-participation" data-label="Participação"><i><b style={{ width: `${participation}%` }} /></i>{participation.toFixed(1).replace(".", ",")}%</span></div>;
                })}
                {!data.companies.length && <div className="dashboard-empty">Nenhuma venda no período.</div>}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}

function HomeScreen({ sellerId, sellerName, online }: { sellerId: number; sellerName: string; online: boolean }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardSellers, setDashboardSellers] = useState<DashboardSeller[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState(sellerId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(() => currentMonthStart());
  const [dateTo, setDateTo] = useState(() => inputDate(new Date()));
  const [appliedPeriod, setAppliedPeriod] = useState(() => ({ from: currentMonthStart(), to: inputDate(new Date()) }));
  const [detail, setDetail] = useState<DashboardDetailSelection | null>(null);
  const [detailRows, setDetailRows] = useState<ApiRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [generatingPanelReport, setGeneratingPanelReport] = useState<DashboardPanelReport | null>(null);
  const [reportError, setReportError] = useState("");
  const selectedSellerName = dashboardSellers.find((item) => Number(item.CODVEND) === selectedSellerId)?.APELIDO || sellerName;
  const cacheKey = `norte-sul-vendas:dashboard:v2:${selectedSellerId}:${appliedPeriod.from}:${appliedPeriod.to}`;
  const periodLabel = `${displayPeriodDate(appliedPeriod.from)} a ${displayPeriodDate(appliedPeriod.to)}`;

  const selectPeriod = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setAppliedPeriod({ from, to });
  };

  useEffect(() => {
    setSelectedSellerId(sellerId);
  }, [sellerId]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void api<{ rows: DashboardSeller[] }>("/api/sankhya/data?kind=dashboardSellers", { cache: "no-store" })
      .then((result) => {
        if (cancelled) return;
        setDashboardSellers(result.rows.map((item) => ({ CODVEND: Number(item.CODVEND), APELIDO: String(item.APELIDO || `Vendedor ${item.CODVEND}`) })));
      })
      .catch(() => {
        if (!cancelled) setDashboardSellers([]);
      });
    return () => { cancelled = true; };
  }, [online]);

  const selectCurrentMonth = () => {
    const today = new Date();
    selectPeriod(inputDate(new Date(today.getFullYear(), today.getMonth(), 1)), inputDate(today));
  };

  const selectLastThreeMonths = () => {
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    start.setDate(start.getDate() + 1);
    selectPeriod(inputDate(start), inputDate(today));
  };

  const generateCompleteReport = async () => {
    if (!dashboard || generatingReport) return;
    setGeneratingReport(true);
    setReportError("");
    try {
      let products: ApiRow[] = dashboard.topProducts;
      let clients: ApiRow[] = dashboard.topClients;
      if (online) {
        try {
          const reportParams = new URLSearchParams({ dateFrom: appliedPeriod.from, dateTo: appliedPeriod.to, seller: String(selectedSellerId) });
          const [productResult, clientResult] = await Promise.all([
            api<{ rows: ApiRow[] }>(`/api/sankhya/data?kind=dashboardProducts&${reportParams}`, { cache: "no-store" }),
            api<{ rows: ApiRow[] }>(`/api/sankhya/data?kind=dashboardClients&${reportParams}`, { cache: "no-store" }),
          ]);
          products = productResult.rows;
          clients = clientResult.rows;
        } catch {
          // O resumo carregado permite gerar o PDF mesmo se a consulta detalhada falhar.
        }
      }
      await downloadSalesReport({
        dashboard,
        sellerName: selectedSellerName,
        periodLabel,
        dateFrom: appliedPeriod.from,
        dateTo: appliedPeriod.to,
        products,
        clients,
      });
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Não foi possível gerar o relatório agora.");
    } finally {
      setGeneratingReport(false);
    }
  };

  const generatePanelReport = async (kind: DashboardPanelReport) => {
    if (!dashboard || generatingPanelReport || generatingReport) return;
    setGeneratingPanelReport(kind);
    setReportError("");
    const cachedRows = (type: DashboardDetailType) => {
      try {
        const key = `norte-sul-vendas:dashboard-detail:v2:${selectedSellerId}:${type}:${appliedPeriod.from}:${appliedPeriod.to}:all:all`;
        return JSON.parse(localStorage.getItem(key) || "null") as ApiRow[] | null;
      } catch {
        return null;
      }
    };
    const loadRows = async (type: DashboardDetailType, fallback: ApiRow[]) => {
      const cached = cachedRows(type);
      if (!online) return cached ?? fallback;
      try {
        const params = new URLSearchParams({
          kind: dashboardDetailKinds[type],
          dateFrom: appliedPeriod.from,
          dateTo: appliedPeriod.to,
          seller: String(selectedSellerId),
          _: String(Date.now()),
        });
        const result = await api<{ rows: ApiRow[] }>(`/api/sankhya/data?${params}`, { cache: "no-store" });
        const key = `norte-sul-vendas:dashboard-detail:v2:${selectedSellerId}:${type}:${appliedPeriod.from}:${appliedPeriod.to}:all:all`;
        localStorage.setItem(key, JSON.stringify(result.rows));
        return result.rows;
      } catch {
        return cached ?? fallback;
      }
    };
    try {
      let rows: ApiRow[] = [];
      let portfolioRows: Array<{ segment: string; rows: ApiRow[] }> = [];
      if (kind === "products") rows = await loadRows("products", dashboard.topProducts);
      if (kind === "clients") rows = await loadRows("clients", dashboard.topClients);
      if (kind === "portfolio") {
        const [newClients, recurringClients, reactivatedClients, inactiveClients] = await Promise.all([
          loadRows("newClients", []),
          loadRows("recurringClients", []),
          loadRows("reactivatedClients", []),
          loadRows("inactiveClients", []),
        ]);
        portfolioRows = [
          { segment: "Clientes novos", rows: newClients },
          { segment: "Clientes recorrentes", rows: recurringClients },
          { segment: "Clientes reativados", rows: reactivatedClients },
          { segment: "Clientes que precisam de atencao", rows: inactiveClients },
        ];
      }
      await downloadDashboardPanelReport({
        kind,
        dashboard,
        sellerName: selectedSellerName,
        periodLabel,
        dateFrom: appliedPeriod.from,
        dateTo: appliedPeriod.to,
        rows,
        portfolioRows,
      });
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Não foi possível gerar o PDF deste painel.");
    } finally {
      setGeneratingPanelReport(null);
    }
  };

  const panelPdfButton = (kind: DashboardPanelReport, label: string) => (
    <button
      className="panel-pdf-button"
      onClick={() => void generatePanelReport(kind)}
      disabled={generatingPanelReport !== null || generatingReport}
      aria-label={`Gerar PDF de ${label}`}
      title={`Gerar PDF de ${label}`}
    >
      {generatingPanelReport === kind ? <LoaderCircle className="spin" size={14} /> : <FileText size={14} />}
      <span>PDF</span>
    </button>
  );

  const openDashboardDetail = (selection: DashboardDetailSelection) => {
    setDetail(selection);
    window.history.pushState(
      { norteSulVendas: true, view: "home", dialog: "dashboard-detail" } satisfies AppHistoryState,
      "",
      window.location.href,
    );
  };

  const closeDashboardDetail = () => window.history.back();

  useEffect(() => {
    const closeOnBack = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;
      if (state?.dialog !== "dashboard-detail") setDetail(null);
    };
    window.addEventListener("popstate", closeOnBack);
    return () => window.removeEventListener("popstate", closeOnBack);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = async () => {
      setLoading(true);
      setDashboard(null);
      setError("");
      try {
        if (!online) throw new Error("OFFLINE");
        const params = new URLSearchParams({ kind: "dashboard", dateFrom: appliedPeriod.from, dateTo: appliedPeriod.to, seller: String(selectedSellerId) });
        const result = await api<DashboardData>(`/api/sankhya/data?${params}`);
        if (cancelled) return;
        setDashboard(result);
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as DashboardData | null;
          if (!cancelled && cached) {
            setDashboard(cached);
            setError("Exibindo o último resumo salvo neste aparelho.");
          } else if (!cancelled) {
            setError(online ? "Não foi possível carregar o desempenho agora." : "Faça uma carga online para salvar o painel neste aparelho.");
          }
        } catch {
          if (!cancelled) setError("Não foi possível carregar o desempenho agora.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadDashboard();
    return () => { cancelled = true; };
  }, [appliedPeriod.from, appliedPeriod.to, cacheKey, online, selectedSellerId]);

  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    const loadDetail = async () => {
      setDetailLoading(true);
      setDetailRows([]);
      setDetailError("");
      const detailCacheKey = `norte-sul-vendas:dashboard-detail:v2:${selectedSellerId}:${detail.type}:${appliedPeriod.from}:${appliedPeriod.to}:${detail.date || "all"}:${detail.groupId || "all"}`;
      try {
        if (!online) throw new Error("OFFLINE");
        const params = new URLSearchParams({
          kind: dashboardDetailKinds[detail.type],
          dateFrom: appliedPeriod.from,
          dateTo: appliedPeriod.to,
          seller: String(selectedSellerId),
        });
        if (detail.date) {
          const [day, month, year] = detail.date.split("/");
          params.set("date", `${year}-${month}-${day}`);
        }
        if (detail.groupId) params.set("group", String(detail.groupId));
        params.set("_", String(Date.now()));
        const result = await api<{ rows: ApiRow[] }>(`/api/sankhya/data?${params}`, { cache: "no-store" });
        if (cancelled) return;
        const validRows = detail.type === "day"
          ? result.rows.every((row) => row.NUNOTA != null && row.NOMEPARC != null)
          : detail.type === "products" || detail.type === "groupProducts"
            ? result.rows.every((row) => row.ENTITY_ID != null && row.ENTITY_NAME != null && row.QUANTITY != null)
            : detail.type === "clients"
              ? result.rows.every((row) => row.ENTITY_ID != null && row.ENTITY_NAME != null && row.AVG_TICKET != null)
              : detail.type === "inactiveClients"
                ? result.rows.every((row) => row.ENTITY_ID != null && row.ENTITY_NAME != null && row.DAYS_WITHOUT_PURCHASE != null)
                : result.rows.every((row) => row.ENTITY_ID != null && row.ENTITY_NAME != null && row.REFERENCE_DATE != null);
        if (!validRows) throw new Error("INVALID_DETAIL_RESPONSE");
        setDetailRows(result.rows);
        localStorage.setItem(detailCacheKey, JSON.stringify(result.rows));
      } catch {
        try {
          const cached = JSON.parse(localStorage.getItem(detailCacheKey) || "null") as ApiRow[] | null;
          if (!cancelled && cached) {
            setDetailRows(cached);
            setDetailError("Exibindo os últimos detalhes salvos neste aparelho.");
          } else if (!cancelled) {
            setDetailError(online ? "Não foi possível carregar os detalhes agora." : "Estes detalhes ainda não foram consultados neste aparelho.");
          }
        } catch {
          if (!cancelled) setDetailError("Não foi possível carregar os detalhes agora.");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void loadDetail();
    return () => { cancelled = true; };
  }, [appliedPeriod.from, appliedPeriod.to, detail, online, selectedSellerId]);

  const maxDaily = Math.max(...(dashboard?.dailySales.map((item) => Number(item.SALES_VALUE)) ?? [0]), 1);
  const maxProduct = Math.max(...(dashboard?.topProducts.map((item) => Number(item.QUANTITY)) ?? [0]), 1);
  const groupSalesTotal = dashboard?.salesByGroup.reduce((sum, item) => sum + Number(item.SALES_VALUE), 0) ?? 0;
  const maxGroupSales = Math.max(...(dashboard?.salesByGroup.map((item) => Number(item.SALES_VALUE)) ?? [0]), 1);

  return (
    <div className="page dashboard-page">
      <header className="mobile-header dashboard-mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Início</h1><p>Seu desempenho em vendas</p></div>
        <div className="dashboard-mobile-actions">
          <button className="icon-button dashboard-report-mobile" onClick={() => void generateCompleteReport()} disabled={!dashboard || loading || generatingReport} aria-label="Gerar relatório completo em PDF" title="Gerar relatório em PDF">
            {generatingReport ? <LoaderCircle className="spin" size={19} /> : <FileText size={19} />}
          </button>
          <span className={`connection-dot ${online ? "online" : "offline"}`} aria-label={online ? "Online" : "Offline"} />
        </div>
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Desempenho comercial</span><h1>Olá, {sellerName.split(" ")[0]}</h1><p>Acompanhe seus resultados de {periodLabel}.</p></div>
        <div className="dashboard-header-actions">
          <button className="primary dashboard-report-button" onClick={() => void generateCompleteReport()} disabled={!dashboard || loading || generatingReport}>
            {generatingReport ? <LoaderCircle className="spin" size={17} /> : <FileText size={17} />}
            {generatingReport ? "Gerando relatório..." : "Gerar relatório completo"}
          </button>
          <span className={`connection-badge ${online ? "online" : "offline"}`}>{online ? <CloudCheck size={16} /> : <CloudOff size={16} />}{online ? "Dados do Sankhya" : "Dados salvos"}</span>
        </div>
      </header>

      {dashboardSellers.length > 0 && (
        <section className="dashboard-seller-switch" aria-label="Selecionar vendedor para análise">
          <UsersRound size={19} />
          <label>
            <span>Analisando vendedor</span>
            <select value={selectedSellerId} onChange={(event) => setSelectedSellerId(Number(event.target.value))}>
              {dashboardSellers.map((seller) => <option key={seller.CODVEND} value={seller.CODVEND}>{seller.APELIDO}</option>)}
            </select>
          </label>
          <small>Os indicadores e relatórios abaixo respeitam o vendedor selecionado.</small>
        </section>
      )}

      <section className="dashboard-period-filter" aria-label="Período do desempenho">
        <div className="dashboard-period-title"><CalendarDays size={20} /><span><strong>Período analisado</strong><small>{periodLabel}</small></span></div>
        <div className="dashboard-period-presets">
          <button className={appliedPeriod.from === currentMonthStart() && appliedPeriod.to === inputDate(new Date()) ? "active" : ""} onClick={selectCurrentMonth}>Este mês</button>
          <button onClick={() => selectPeriod(daysAgo(29), inputDate(new Date()))}>Últimos 30 dias</button>
          <button onClick={selectLastThreeMonths}>Últimos 3 meses</button>
        </div>
        <label>De<input type="date" value={dateFrom} max={dateTo || inputDate(new Date())} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Até<input type="date" value={dateTo} min={dateFrom} max={inputDate(new Date())} onChange={(event) => setDateTo(event.target.value)} /></label>
        <button className="primary dashboard-period-apply" disabled={!dateFrom || !dateTo || dateFrom > dateTo || (dateFrom === appliedPeriod.from && dateTo === appliedPeriod.to)} onClick={() => setAppliedPeriod({ from: dateFrom, to: dateTo })}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Filter size={17} />} Aplicar
        </button>
      </section>

      {error && <div className="dashboard-notice"><CloudOff size={17} /> {error}</div>}
      {reportError && <div className="dashboard-notice"><FileText size={17} /> {reportError}</div>}
      {loading && !dashboard ? (
        <div className="dashboard-loading"><LoaderCircle className="spin" /><span>Calculando seu desempenho...</span></div>
      ) : dashboard ? (
        <>
          <section className="dashboard-kpis" aria-label="Resumo do período">
            <article className="dashboard-kpi featured"><span><CircleDollarSign /></span><div><small>Vendas no período</small><strong>{money(Number(dashboard.summary.SALES_VALUE))}</strong><em>{periodLabel}</em></div></article>
            <article className="dashboard-kpi"><span><ShoppingBag /></span><div><small>Pedidos faturados</small><strong>{dashboard.summary.ORDER_COUNT}</strong></div></article>
            <article className="dashboard-kpi"><span><ClipboardList /></span><div><small>Ticket médio</small><strong>{money(Number(dashboard.summary.AVG_TICKET))}</strong><em>por pedido</em></div></article>
            <article className="dashboard-kpi"><span><UsersRound /></span><div><small>Clientes atendidos</small><strong>{dashboard.summary.CLIENT_COUNT}</strong><em>clientes únicos</em></div></article>
          </section>

          <section className="dashboard-grid">
            <article className="dashboard-card sales-chart-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Evolução</span><div className="dashboard-panel-title-row"><h2>Valor de vendas por dia</h2>{panelPdfButton("evolution", "Evolução das vendas")}</div></div><strong>{money(Number(dashboard.summary.SALES_VALUE))}</strong></div>
              {dashboard.dailySales.length ? (
                <div className="sales-bars" aria-label="Gráfico diário de vendas">
                  {dashboard.dailySales.map((item) => (
                    <button className="sales-bar-item" key={item.SALE_DATE} title={`${item.SALE_DATE}: ${money(Number(item.SALES_VALUE))}. Abrir pedidos do dia.`} onClick={() => openDashboardDetail({ type: "day", date: item.SALE_DATE })}>
                      <span>{money(Number(item.SALES_VALUE)).replace("R$ ", "")}</span>
                      <div><i style={{ height: `${Math.max(8, (Number(item.SALES_VALUE) / maxDaily) * 100)}%` }} /></div>
                      <small>{item.SALE_DATE.slice(0, 5)}</small>
                    </button>
                  ))}
                </div>
              ) : <div className="dashboard-empty">Nenhuma venda faturada neste período.</div>}
            </article>

            <article className="dashboard-card product-ranking-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Mix de vendas</span><div className="dashboard-panel-title-row"><h2>Produtos mais vendidos</h2>{panelPdfButton("products", "Mix de vendas")}</div></div><span className="dashboard-card-actions"><button onClick={() => openDashboardDetail({ type: "products" })}>Saiba mais <ArrowRight size={14} /></button><PackageCheck /></span></div>
              {dashboard.topProducts.length ? (
                <div className="ranking-list">
                  {dashboard.topProducts.map((item, index) => (
                    <div className="ranking-row" key={`${item.CODPROD}-${index}`}>
                      <b>{index + 1}</b><div><strong>{item.DESCRPROD}</strong><small>Cód. {item.CODPROD} · {Number(item.QUANTITY).toLocaleString("pt-BR")} un.</small><span><i style={{ width: `${Math.max(6, (Number(item.QUANTITY) / maxProduct) * 100)}%` }} /></span></div><em>{money(Number(item.SALES_VALUE))}</em>
                    </div>
                  ))}
                </div>
              ) : <div className="dashboard-empty">Nenhum produto vendido neste período.</div>}
            </article>

            <article className="dashboard-card group-sales-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Composição do faturamento</span><div className="dashboard-panel-title-row"><h2>Vendas por grupo de produto</h2>{panelPdfButton("groups", "Grupos de produtos")}</div></div><Box /></div>
              {dashboard.salesByGroup.length ? (
                <div className="group-sales-bars">
                  {dashboard.salesByGroup.map((item) => {
                    const value = Number(item.SALES_VALUE);
                    const share = groupSalesTotal ? (value / groupSalesTotal) * 100 : 0;
                    return (
                      <button className="group-sales-row" key={item.CODGRUPOPROD} onClick={() => openDashboardDetail({ type: "groupProducts", groupId: Number(item.CODGRUPOPROD), groupName: String(item.DESCRGRUPOPROD) })} title={`Ver produtos vendidos do grupo ${item.DESCRGRUPOPROD}`}>
                        <div><strong>{item.DESCRGRUPOPROD}</strong><small>{share.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de participação</small></div>
                        <em>{money(value)}</em>
                        <span><i style={{ width: `${Math.max(2, (value / maxGroupSales) * 100)}%` }} /></span>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="dashboard-empty">Nenhuma venda por grupo neste período.</div>}
            </article>

            <article className="dashboard-card clients-ranking-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Relacionamento</span><div className="dashboard-panel-title-row"><h2>Principais clientes do período</h2>{panelPdfButton("clients", "Relacionamento com clientes")}</div></div><span className="dashboard-card-actions"><button onClick={() => openDashboardDetail({ type: "clients" })}>Saiba mais <ArrowRight size={14} /></button><Building2 /></span></div>
              {dashboard.topClients.length ? (
                <div className="client-ranking-list">
                  {dashboard.topClients.map((item, index) => (
                    <div key={item.CODPARC}><b>{index + 1}</b><span><strong>{item.NOMEPARC}</strong><small>{item.ORDER_COUNT} {Number(item.ORDER_COUNT) === 1 ? "pedido" : "pedidos"}</small></span><em>{money(Number(item.SALES_VALUE))}</em></div>
                  ))}
                </div>
              ) : <div className="dashboard-empty">Nenhum cliente faturado neste período.</div>}
            </article>
          </section>

          <section className="dashboard-secondary-grid">
            <article className="dashboard-card client-portfolio-card">
              <div className="dashboard-card-heading"><div><span className="eyebrow">Relacionamento comercial</span><div className="dashboard-panel-title-row"><h2>Carteira de clientes</h2>{panelPdfButton("portfolio", "Carteira de clientes")}</div></div><UsersRound /></div>
              <div className="portfolio-indicators">
                <button onClick={() => openDashboardDetail({ type: "newClients" })}><span><UserRound /></span><div><small>Clientes novos</small><strong>{Number(dashboard.clientPortfolio.NEW_CLIENTS)}</strong></div><ArrowRight className="portfolio-card-arrow" /></button>
                <button onClick={() => openDashboardDetail({ type: "recurringClients" })}><span><UsersRound /></span><div><small>Clientes recorrentes</small><strong>{Number(dashboard.clientPortfolio.RECURRING_CLIENTS)}</strong></div><ArrowRight className="portfolio-card-arrow" /></button>
                <button onClick={() => openDashboardDetail({ type: "reactivatedClients" })}><span><RefreshCw /></span><div><small>Clientes reativados</small><strong>{Number(dashboard.clientPortfolio.REACTIVATED_CLIENTS)}</strong></div><ArrowRight className="portfolio-card-arrow" /></button>
                <button className="attention" onClick={() => openDashboardDetail({ type: "inactiveClients" })}><span><CalendarDays /></span><div><small>Precisam de atenção</small><strong>{Number(dashboard.clientPortfolio.INACTIVE_30)}</strong><em>30+ dias sem comprar</em></div><ArrowRight className="portfolio-card-arrow" /></button>
              </div>
              <div className="portfolio-attention-strip">
                <div><strong>{Number(dashboard.clientPortfolio.INACTIVE_30)} clientes precisam de atenção</strong><span><small>30+ dias <b>{Number(dashboard.clientPortfolio.INACTIVE_30)}</b></small><small>60+ dias <b>{Number(dashboard.clientPortfolio.INACTIVE_60)}</b></small><small>90+ dias <b>{Number(dashboard.clientPortfolio.INACTIVE_90)}</b></small></span></div>
                <button className="primary" onClick={() => openDashboardDetail({ type: "inactiveClients" })}>Ver clientes <ArrowRight size={16} /></button>
              </div>
            </article>
          </section>
        </>
      ) : null}
      {detail && (
        <DashboardDetailPanel
          selection={detail}
          rows={detailRows}
          loading={detailLoading}
          error={detailError}
          periodLabel={periodLabel}
          onClose={closeDashboardDetail}
        />
      )}
    </div>
  );
}

function DashboardDetailPanel({
  selection,
  rows,
  loading,
  error,
  periodLabel,
  onClose,
}: {
  selection: DashboardDetailSelection;
  rows: ApiRow[];
  loading: boolean;
  error: string;
  periodLabel: string;
  onClose: () => void;
}) {
  const title = selection.type === "day"
    ? `Pedidos de ${selection.date}`
    : selection.type === "products"
      ? "Mix de vendas completo"
      : selection.type === "groupProducts"
        ? `Produtos vendidos — ${selection.groupName}`
        : selection.type === "clients"
        ? "Relacionamento completo"
        : selection.type === "newClients"
          ? "Clientes novos"
          : selection.type === "recurringClients"
            ? "Clientes recorrentes"
            : selection.type === "reactivatedClients"
              ? "Clientes reativados"
              : "Clientes que precisam de atenção";
  const productDetail = selection.type === "products" || selection.type === "groupProducts";
  const clientSegment = selection.type === "newClients" || selection.type === "recurringClients" || selection.type === "reactivatedClients";
  const total = rows.reduce((sum, row) => sum + Number(row.SALES_VALUE ?? row.VLRNOTA ?? 0), 0);
  const quantity = rows.reduce((sum, row) => sum + Number(row.QUANTITY ?? 0), 0);

  return (
    <div className="dashboard-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="dashboard-detail-panel" role="dialog" aria-modal="true" aria-labelledby="dashboard-detail-title">
        <header>
          <div><span className="eyebrow">Detalhes do desempenho</span><h2 id="dashboard-detail-title">{title}</h2><p>{selection.type === "day" ? "Pedidos faturados no dia selecionado." : selection.type === "inactiveClients" ? "Clientes da sua carteira sem comprar há 30 dias ou mais." : clientSegment ? `Clientes classificados no período de ${periodLabel}.` : `Informações completas de ${periodLabel}.`}</p></div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar painel"><X size={20} /></button>
        </header>

        {error && <div className="dashboard-detail-notice"><CloudOff size={16} /> {error}</div>}
        <section className="dashboard-detail-summary">
          <article><small>{selection.type === "day" ? "Pedidos" : selection.type === "inactiveClients" ? "Clientes que precisam de atenção" : clientSegment ? "Clientes" : "Registros"}</small><strong>{rows.length}</strong></article>
          {productDetail && <article><small>Unidades vendidas</small><strong>{quantity.toLocaleString("pt-BR")}</strong></article>}
          {selection.type !== "inactiveClients" && <article><small>Valor total</small><strong>{money(total)}</strong></article>}
        </section>

        <div className="dashboard-detail-content">
          {loading ? <div className="dashboard-detail-empty"><LoaderCircle className="spin" /> Carregando detalhes...</div> : selection.type === "day" ? (
            <div className="detail-order-list">
              {rows.map((row) => (
                <article key={String(row.NUNOTA)}>
                  <span className="order-icon"><ShoppingBag size={18} /></span>
                  <div><strong>{String(row.NOMEPARC)}</strong><small>Pedido {String(row.NUNOTA)} · Cliente {String(row.CODPARC)}</small></div>
                  <em>{money(Number(row.VLRNOTA || 0))}</em>
                </article>
              ))}
            </div>
          ) : productDetail ? (
            <div className="detail-ranking-list">
              {rows.map((row, index) => (
                <article key={String(row.ENTITY_ID)}><b>{index + 1}</b><div><strong>{String(row.ENTITY_NAME)}</strong><small>Cód. {String(row.ENTITY_ID)} · {Number(row.QUANTITY).toLocaleString("pt-BR")} unidades</small></div><em>{money(Number(row.SALES_VALUE || 0))}</em></article>
              ))}
            </div>
          ) : selection.type === "clients" ? (
            <div className="detail-ranking-list">
              {rows.map((row, index) => (
                <article key={String(row.ENTITY_ID)}><b>{index + 1}</b><div><strong>{String(row.ENTITY_NAME)}</strong><small>Cód. {String(row.ENTITY_ID)} · {String(row.ORDER_COUNT)} {Number(row.ORDER_COUNT) === 1 ? "pedido" : "pedidos"}</small></div><em>{money(Number(row.SALES_VALUE || 0))}</em></article>
              ))}
            </div>
          ) : clientSegment ? (
            <div className="detail-client-segment-list">
              {rows.map((row) => (
                <article key={String(row.ENTITY_ID)}>
                  <span className="client-avatar"><UserRound size={18} /></span>
                  <div><strong>{String(row.ENTITY_NAME)}</strong><small>Cód. {String(row.ENTITY_ID)} · {selection.type === "newClients" ? `Primeira compra: ${String(row.REFERENCE_DATE)}` : selection.type === "recurringClients" ? `Compra no período: ${String(row.REFERENCE_DATE)} · Anterior: ${String(row.PREVIOUS_PURCHASE)}` : `Reativado em: ${String(row.REFERENCE_DATE)} · ${Number(row.DAYS_TO_RETURN)} dias de intervalo`}</small></div>
                  <em>{money(Number(row.SALES_VALUE || 0))}</em>
                </article>
              ))}
            </div>
          ) : (
            <div className="detail-inactive-list">
              {rows.map((row) => (
                <article key={String(row.ENTITY_ID)}>
                  <span className="client-avatar"><Building2 size={18} /></span>
                  <div><strong>{String(row.ENTITY_NAME)}</strong><small>Cód. {String(row.ENTITY_ID)} · Última compra: {row.LAST_PURCHASE ? String(row.LAST_PURCHASE) : "Sem histórico"}</small></div>
                  <em>{Number(row.DAYS_WITHOUT_PURCHASE) >= 99999 ? "Sem compra" : `${Number(row.DAYS_WITHOUT_PURCHASE)} dias`}</em>
                </article>
              ))}
            </div>
          )}
          {!loading && !rows.length && <div className="dashboard-detail-empty">Nenhuma informação encontrada para este filtro.</div>}
        </div>
      </aside>
    </div>
  );
}

function OrdersScreen({
  orders,
  loading,
  drafts,
  onNew,
  onResume,
  onPeriodChange,
}: {
  orders: ApiRow[];
  loading: boolean;
  drafts: OrderDraft[];
  onNew: () => void;
  onResume: (draft: OrderDraft) => void;
  onPeriodChange: (dateFrom?: string, dateTo?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [showPeriod, setShowPeriod] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => currentMonthStart());
  const [dateTo, setDateTo] = useState(() => inputDate(new Date()));
  const applySuggestedPeriod = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    onPeriodChange(from, to);
    setShowPeriod(false);
  };
  const lastThreeMonthsStart = () => {
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    start.setDate(start.getDate() + 1);
    return inputDate(start);
  };
  const filtered = orders.filter((order) => {
    const matchesSearch = `${order.NUNOTA} ${order.NUMNOTA} ${order.NOMEPARC}`.toLowerCase().includes(query.toLowerCase());
    const state = order.STATUSNOTA === "L" ? "Enviados" : "Aguardando";
    return matchesSearch && filter !== "Rascunhos" && (filter === "Todos" || filter === state);
  });
  const filteredDrafts = drafts.filter((draft) => {
    const matchesSearch = `${draft.partner.NOMEPARC} ${draft.partner.CODPARC}`.toLowerCase().includes(query.toLowerCase());
    return matchesSearch && (filter === "Todos" || filter === "Rascunhos");
  });
  const total = orders.reduce((sum, order) => sum + Number(order.VLRNOTA || 0), 0);

  return (
    <div className="page orders-page">
      <header className="mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Pedidos</h1><p>Acompanhe seus pedidos e rascunhos</p></div>
        <button className="icon-button"><Bell size={23} /></button>
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Operação comercial</span><h1>Pedidos</h1><p>Acompanhe sua carteira e crie novas vendas.</p></div>
        <button className="primary" onClick={onNew}><Plus size={19} /> Novo pedido</button>
      </header>

      <div className="search-row">
        <label className="search-box"><Search size={21} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pedido ou cliente" /></label>
        <button className={`filter-button ${dateFrom || dateTo ? "active" : ""}`} onClick={() => setShowPeriod((current) => !current)} aria-expanded={showPeriod}>
          <Filter size={20} /><span>{dateFrom || dateTo ? "Período ativo" : "Período"}</span>
        </button>
      </div>

      {showPeriod && (
        <section className="period-filter">
          <div><CalendarDays size={20} /><span><strong>Filtrar por período</strong><small>A consulta será refeita diretamente no Sankhya.</small></span></div>
          <div className="period-filter-presets" aria-label="Períodos sugeridos">
            <button className={dateFrom === currentMonthStart() && dateTo === inputDate(new Date()) ? "active" : ""} onClick={() => applySuggestedPeriod(currentMonthStart(), inputDate(new Date()))}>Este mês</button>
            <button onClick={() => applySuggestedPeriod(daysAgo(29), inputDate(new Date()))}>Últimos 30 dias</button>
            <button onClick={() => applySuggestedPeriod(lastThreeMonthsStart(), inputDate(new Date()))}>Últimos 3 meses</button>
          </div>
          <label>De<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>Até<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
          <button className="secondary" onClick={() => {
            setDateFrom(currentMonthStart());
            setDateTo(inputDate(new Date()));
            onPeriodChange(currentMonthStart(), inputDate(new Date()));
            setShowPeriod(false);
          }}>Este mês</button>
          <button className="primary" disabled={!dateFrom || !dateTo || dateFrom > dateTo} onClick={() => {
            onPeriodChange(dateFrom, dateTo);
            setShowPeriod(false);
          }}>Aplicar</button>
        </section>
      )}

      <div className="filter-chips">
        {["Todos", "Enviados", "Rascunhos", "Aguardando"].map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>

      <section className="metrics">
        <Metric icon={<CircleDollarSign />} label="Total em carteira" value={money(total)} />
        <Metric icon={<Send />} label="Enviados" value={String(orders.filter((o) => o.STATUSNOTA === "L").length)} />
        <Metric blue icon={<FileText />} label="Rascunhos" value={String(drafts.length)} />
      </section>

      <section className="orders-section">
        <div className="section-heading"><div><span className="eyebrow">Movimentações</span><h2>Pedidos recentes</h2></div><button>Ver todos <ArrowRight size={17} /></button></div>
        <div className="order-table-head"><span>Cliente</span><span>Data</span><span>Valor</span><span>Status</span></div>
        <div className="order-list">
          {filteredDrafts.map((draft) => (
            <button className="order-card draft-card" key={draft.id} onClick={() => onResume(draft)}>
              <span className="order-icon"><FileText /></span>
              <div className="order-client"><strong>{draft.partner.NOMEPARC}</strong><small>Rascunho automático</small></div>
              <div className="order-date"><small>{new Date(draft.updatedAt).toLocaleDateString("pt-BR")}</small></div>
              <div className="order-total"><strong>{money(draft.cart.reduce((sum, item) => sum + Number(item.VLRVENDA) * item.quantity, 0))}</strong></div>
              <span className="status draft"><FileText size={15} /> Continuar</span>
            </button>
          ))}
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando pedidos...</div> : filtered.map((order, index) => (
            <article className="order-card" key={String(order.NUNOTA)}>
              <span className="order-icon">{index % 2 ? <Leaf /> : <Building2 />}</span>
              <div className="order-client"><strong>{String(order.NOMEPARC)}</strong><small>PED-{String(order.NUNOTA)}</small></div>
              <div className="order-date"><small>{sankhyaDate(order.DTNEG)}</small></div>
              <div className="order-total"><strong>{money(Number(order.VLRNOTA || 0))}</strong></div>
              <span className={`status ${order.STATUSNOTA === "L" ? "sent" : "waiting"}`}>
                {order.STATUSNOTA === "L" ? <><Send size={15} /> Enviado</> : <>Aguardando</>}
              </span>
            </article>
          ))}
          {!loading && !filtered.length && !filteredDrafts.length && <div className="empty-state">Nenhum pedido encontrado.</div>}
        </div>
      </section>
      <button className="mobile-fab" onClick={onNew}><Plus size={23} /> Novo pedido</button>
    </div>
  );
}

function Metric({ icon, label, value, blue }: { icon: React.ReactNode; label: string; value: string; blue?: boolean }) {
  return <div className={`metric ${blue ? "blue" : ""}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function ClientsScreen({
  clients,
  loading,
}: {
  clients: Client[];
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = clients.filter((client) =>
    `${client.NOMEPARC} ${client.CODPARC} ${client.CGCCPF ?? ""}`.toLowerCase().includes(normalized),
  );
  const configured = clients.filter((client) => client.CODTAB != null).length;

  return (
    <div className="page clients-page">
      <header className="mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Clientes</h1><p>Sua carteira no Sankhya</p></div>
        <button className="icon-button"><Bell size={23} /></button>
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Carteira comercial</span><h1>Clientes</h1><p>Todos os clientes ativos vinculados ao seu cadastro de vendedor.</p></div>
      </header>

      <label className="search-box clients-search">
        <Search size={21} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente por nome, código ou CPF/CNPJ" />
      </label>

      <section className="metrics client-metrics">
        <Metric icon={<UsersRound />} label="Clientes na carteira" value={String(clients.length)} />
        <Metric icon={<CircleDollarSign />} label="Com tabela de preço" value={String(configured)} />
        <Metric blue icon={<ClipboardList />} label="Sem tabela definida" value={String(clients.length - configured)} />
      </section>

      <section>
        <div className="section-heading">
          <div><span className="eyebrow">Vendedor logado</span><h2>Minha carteira</h2><p>{filtered.length} {filtered.length === 1 ? "cliente encontrado" : "clientes encontrados"}</p></div>
        </div>
        <div className="client-grid">
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando toda a carteira...</div> : filtered.map((client) => (
            <article className="client-card" key={client.CODPARC}>
              <span className="client-avatar"><Building2 size={20} /></span>
              <div className="client-main">
                <strong>{client.NOMEPARC}</strong>
                <small>Cód. {client.CODPARC}{client.CGCCPF ? ` · ${client.CGCCPF}` : ""}</small>
                <div className="client-contact">
                  {client.TELEFONE && <span><Phone size={13} /> {client.TELEFONE}</span>}
                  {client.EMAIL && <span><Mail size={13} /> {client.EMAIL}</span>}
                </div>
              </div>
              <div className="client-commercial">
                <span className={client.CODTAB != null ? "configured" : "missing"}>
                  {client.CODTAB != null ? `Tabela ${client.CODTAB}` : "Sem tabela"}
                </span>
                {client.GRUPOICMS != null && <small>Grupo ICMS {client.GRUPOICMS}</small>}
              </div>
            </article>
          ))}
          {!loading && !filtered.length && <div className="empty-state">Nenhum cliente encontrado na carteira.</div>}
        </div>
      </section>
    </div>
  );
}

function CommunicationScreen({
  currentUserId,
  currentUserName,
  online,
}: {
  currentUserId: number;
  currentUserName: string;
  online: boolean;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [users, setUsers] = useState<SankhyaChatUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadConversations = async () => {
    if (!online) return;
    try {
      const result = await api<{ rows: ChatConversation[] }>("/api/chat/conversations");
      setConversations(result.rows);
      setActiveConversation((current) =>
        current ? result.rows.find((item) => item.id === current.id) ?? current : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as conversas.");
    }
  };

  const loadMessages = async (conversation: ChatConversation, quiet = false) => {
    if (!online) return;
    if (!quiet) setLoading(true);
    try {
      const result = await api<{ rows: ChatMessage[] }>(
        `/api/chat/messages?conversation=${encodeURIComponent(conversation.id)}`,
      );
      setMessages(result.rows);
      setConversations((current) =>
        current.map((item) => item.id === conversation.id ? { ...item, unread_count: 0 } : item),
      );
      window.setTimeout(() => {
        const container = document.querySelector(".chat-messages");
        if (container) container.scrollTop = container.scrollHeight;
      }, 0);
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "Não foi possível carregar as mensagens.");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (!online) return;
    void loadConversations();
    const timer = window.setInterval(() => void loadConversations(), 5000);
    return () => window.clearInterval(timer);
  }, [online]);

  useEffect(() => {
    if (!activeConversation || !online) {
      setMessages([]);
      return;
    }
    void loadMessages(activeConversation);
    const timer = window.setInterval(() => void loadMessages(activeConversation, true), 3000);
    return () => window.clearInterval(timer);
  }, [activeConversation?.id, online]);

  useEffect(() => {
    const handleChatBack = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;
      if (state?.norteSulVendas && state.view === "communication" && !state.conversationId) {
        setActiveConversation(null);
      }
    };
    window.addEventListener("popstate", handleChatBack);
    return () => window.removeEventListener("popstate", handleChatBack);
  }, []);

  useEffect(() => {
    if (!showUserSearch || !online || !userQuery.trim()) {
      setUsers([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api<{ rows: SankhyaChatUser[] }>(`/api/chat/users?q=${encodeURIComponent(userQuery)}`)
        .then((result) => setUsers(result.rows))
        .catch((err) => setError(err instanceof Error ? err.message : "Falha na pesquisa."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [showUserSearch, userQuery, online]);

  const openConversation = (conversation: ChatConversation) => {
    setShowUserSearch(false);
    const current = window.history.state as AppHistoryState | null;
    window.history.pushState(
      { ...(current ?? {}), norteSulVendas: true, view: "communication", conversationId: conversation.id } satisfies AppHistoryState,
      "",
      window.location.href,
    );
    setActiveConversation(conversation);
    setError("");
  };

  const startConversation = async (chatUser: SankhyaChatUser) => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ conversation: ChatConversation }>("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientUserId: Number(chatUser.CODUSU) }),
      });
      setConversations((current) => [
        result.conversation,
        ...current.filter((item) => item.id !== result.conversation.id),
      ]);
      setShowUserSearch(false);
      setUserQuery("");
      const current = window.history.state as AppHistoryState | null;
      window.history.pushState(
        { ...(current ?? {}), norteSulVendas: true, view: "communication", conversationId: result.conversation.id } satisfies AppHistoryState,
        "",
        window.location.href,
      );
      setActiveConversation(result.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível iniciar a conversa.");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const body = messageBody.trim();
    if (!body || !activeConversation || sending || !online) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ message: ChatMessage }>("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversation.id, body }),
      });
      setMessages((current) => [...current, result.message]);
      setMessageBody("");
      void loadConversations();
      window.setTimeout(() => {
        const container = document.querySelector(".chat-messages");
        if (container) container.scrollTop = container.scrollHeight;
      }, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  const chatTime = (value?: number | null) =>
    value ? new Date(Number(value)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="page communication-page">
      <header className="mobile-header chat-mobile-heading">
        <BrandMark compact />
        <div className="page-title"><h1>Comunicação</h1><p>Converse com a equipe</p></div>
        <span className={`connection-dot ${online ? "online" : "offline"}`} />
      </header>
      {!online ? (
        <div className="chat-offline"><CloudOff size={28} /><strong>Comunicação indisponível offline</strong><span>Conecte-se à internet para receber e enviar mensagens.</span></div>
      ) : (
        <section className={`chat-shell ${activeConversation ? "has-active-chat" : ""}`}>
          <aside className="chat-sidebar">
            <div className="chat-sidebar-header">
              <div><strong>Conversas</strong><small>{currentUserName}</small></div>
              <button aria-label="Nova conversa" onClick={() => {
                setShowUserSearch(true);
                setActiveConversation(null);
                setUserQuery("");
              }}><Plus size={20} /></button>
            </div>
            <label className="search-box chat-search">
              <Search size={18} />
              <input
                value={showUserSearch ? userQuery : ""}
                onFocus={() => setShowUserSearch(true)}
                onChange={(event) => {
                  setShowUserSearch(true);
                  setUserQuery(event.target.value);
                }}
                placeholder="Pesquisar usuário..."
              />
              {showUserSearch && <button onClick={() => { setShowUserSearch(false); setUserQuery(""); }}><X size={16} /></button>}
            </label>
            <div className="chat-list">
              {showUserSearch ? (
                <>
                  {!userQuery.trim() && <div className="chat-list-empty">Digite o nome ou login do usuário.</div>}
                  {userQuery.trim() && !users.length && !loading && <div className="chat-list-empty">Nenhum usuário encontrado.</div>}
                  {users.map((chatUser) => (
                    <button key={chatUser.CODUSU} className="chat-user-row" onClick={() => void startConversation(chatUser)}>
                      <span className="chat-avatar">{String(chatUser.NOME).charAt(0).toUpperCase()}</span>
                      <span><strong>{chatUser.NOME}</strong><small>{chatUser.LOGIN} · Usuário {chatUser.CODUSU}</small></span>
                      <MessageCircle size={18} />
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {!conversations.length && <div className="chat-list-empty">Nenhuma conversa ainda.<br />Toque em + para começar.</div>}
                  {conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      className={`conversation-row ${activeConversation?.id === conversation.id ? "active" : ""}`}
                      onClick={() => openConversation(conversation)}
                    >
                      <span className="chat-avatar">{conversation.other_user_name.charAt(0).toUpperCase()}</span>
                      <span className="conversation-copy">
                        <strong>{conversation.other_user_name}</strong>
                        <small>{conversation.last_message || "Conversa iniciada"}</small>
                      </span>
                      <span className="conversation-meta">
                        <small>{chatTime(conversation.last_message_at || conversation.updated_at)}</small>
                        {Number(conversation.unread_count || 0) > 0 && <strong>{conversation.unread_count}</strong>}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </aside>

          <div className="chat-panel">
            {activeConversation ? (
              <>
                <header className="chat-contact-header">
                  <button className="chat-back" onClick={() => window.history.back()}><ArrowLeft size={21} /></button>
                  <span className="chat-avatar">{activeConversation.other_user_name.charAt(0).toUpperCase()}</span>
                  <span><strong>{activeConversation.other_user_name}</strong><small>Usuário Sankhya {activeConversation.other_user_id}</small></span>
                  <span className="connection-dot online" />
                </header>
                <div className="chat-messages">
                  {loading ? <div className="chat-list-empty"><LoaderCircle className="spin" /> Carregando mensagens...</div> : (
                    <>
                      {!messages.length && <div className="chat-welcome"><MessageCircle size={28} /><strong>Início da conversa</strong><span>Envie uma mensagem para {activeConversation.other_user_name}.</span></div>}
                      {messages.map((message) => {
                        const mine = Number(message.sender_user_id) === currentUserId;
                        return (
                          <div className={`message-bubble ${mine ? "mine" : ""}`} key={message.id}>
                            {!mine && <strong>{message.sender_name}</strong>}
                            <p>{message.body}</p>
                            <small>{chatTime(message.created_at)}{mine && message.read_at ? " · Lida" : ""}</small>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
                <form className="chat-composer" onSubmit={sendMessage}>
                  <input
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    placeholder="Digite uma mensagem"
                    maxLength={2000}
                  />
                  <button disabled={!messageBody.trim() || sending} aria-label="Enviar mensagem">
                    {sending ? <LoaderCircle className="spin" size={19} /> : <Send size={20} />}
                  </button>
                </form>
              </>
            ) : (
              <div className="chat-placeholder"><MessageCircle size={42} /><strong>Selecione uma conversa</strong><span>Ou pesquise um usuário do Sankhya para começar.</span></div>
            )}
          </div>
        </section>
      )}
      {error && <div className="global-error chat-error">{error}</div>}
    </div>
  );
}

function MoreScreen({
  user,
  sellerId,
  sellerName,
  online,
  syncing,
  snapshot,
  canInstall,
  installed,
  iosDevice,
  secureContext,
  onInstall,
  onLoad,
  onLogout,
}: {
  user: string;
  sellerId: number;
  sellerName: string;
  online: boolean;
  syncing: boolean;
  snapshot: OfflineSnapshot | null;
  canInstall: boolean;
  installed: boolean;
  iosDevice: boolean;
  secureContext: boolean;
  onInstall: () => void;
  onLoad: () => void;
  onLogout: () => void;
}) {
  const lastLoad = snapshot?.syncedAt
    ? new Date(snapshot.syncedAt).toLocaleString("pt-BR")
    : "Nenhuma carga realizada";

  return (
    <div className="page more-page">
      <header className="mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Mais</h1><p>Dados e sincronização</p></div>
        <span className={`connection-dot ${online ? "online" : "offline"}`} title={online ? "Online" : "Offline"} />
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Área do vendedor</span><h1>Mais</h1><p>Gerencie a carga local e consulte seus dados de acesso.</p></div>
        <span className={`connection-badge ${online ? "online" : "offline"}`}>
          {online ? <CloudCheck size={17} /> : <CloudOff size={17} />}
          {online ? "Conectado" : "Modo offline"}
        </span>
      </header>

      <section className="seller-profile-card">
        <span className="seller-profile-avatar">{(sellerName || user).charAt(0).toUpperCase()}</span>
        <div>
          <small>Vendedor logado</small>
          <h2>{sellerName || user}</h2>
          <p>Usuário {user} · Código do vendedor {sellerId}</p>
        </div>
        <span className={`connection-badge ${online ? "online" : "offline"}`}>
          {online ? <CloudCheck size={17} /> : <CloudOff size={17} />}
          {online ? "Online" : "Offline"}
        </span>
      </section>

      <section className="load-card">
        <div className="load-card-icon"><Database size={25} /></div>
        <div className="load-card-copy">
          <span className="eyebrow">Dados deste aparelho</span>
          <h2>Fazer carga</h2>
          <p>Atualiza clientes, pedidos, tabelas, preços e estoque com os dados atuais do Sankhya.</p>
          <small>Última carga: {lastLoad}</small>
        </div>
        <button className="primary load-button" onClick={onLoad} disabled={!online || syncing}>
          {syncing ? <><LoaderCircle className="spin" size={19} /> Atualizando...</> : <><RefreshCw size={19} /> Fazer carga</>}
        </button>
      </section>

      <section className={`install-card ${!secureContext ? "warning" : ""}`}>
        <div className="load-card-icon"><Download size={25} /></div>
        <div className="load-card-copy">
          <span className="eyebrow">Aplicativo móvel</span>
          <h2>{installed ? "Aplicativo instalado" : "Instalar aplicativo"}</h2>
          {installed ? (
            <p>Esta versão já está sendo executada como aplicativo no aparelho.</p>
          ) : !secureContext ? (
            <p>A instalação real exige um endereço HTTPS. Em endereço local HTTP, o navegador consegue criar somente um atalho.</p>
          ) : iosDevice ? (
            <p>No iPhone, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>
          ) : canInstall ? (
            <p>Instale a versão completa para abrir sem a barra do navegador e trabalhar offline.</p>
          ) : (
            <p>Abra esta tela novamente após a primeira carga. O navegador liberará a instalação quando terminar de preparar o app.</p>
          )}
        </div>
        {canInstall && !installed && (
          <button className="primary load-button" onClick={onInstall}><Download size={19} /> Instalar aplicativo</button>
        )}
      </section>

      <section className="offline-summary">
        <article><UsersRound /><span><small>Clientes salvos</small><strong>{snapshot?.clients.length ?? 0}</strong></span></article>
        <article><ShoppingBag /><span><small>Pedidos salvos</small><strong>{snapshot?.orders.length ?? 0}</strong></span></article>
        <article><PackageCheck /><span><small>Saldos com preço</small><strong>{snapshot?.products.length ?? 0}</strong></span></article>
      </section>

      <div className={`offline-explanation ${online ? "" : "active"}`}>
        {online ? <CloudCheck size={21} /> : <CloudOff size={21} />}
        <div>
          <strong>{online ? "Dados disponíveis offline" : "Você está trabalhando offline"}</strong>
          <p>Clientes, pedidos, preços e estoque da última carga podem ser consultados. Rascunhos continuam sendo salvos; o envio ao Sankhya exige internet.</p>
        </div>
      </div>

      <button className="secondary more-logout" onClick={onLogout}><LogOut size={18} /> Sair do aplicativo</button>
    </div>
  );
}

function ClientPickerModal({
  clients,
  loading,
  onClose,
  onSelect,
}: {
  clients: Client[];
  loading: boolean;
  onClose: () => void;
  onSelect: (client: Partner) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = clients.filter((client) =>
    `${client.NOMEPARC} ${client.CODPARC} ${client.CGCCPF ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="modal-backdrop client-picker-backdrop" role="dialog" aria-modal="true" aria-label="Selecionar cliente">
      <section className="client-picker-modal">
        <header>
          <div><span className="eyebrow">Novo pedido</span><h2>Selecione o cliente</h2><p>Escolha um cliente da sua carteira para iniciar o pedido.</p></div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <label className="search-box wide"><Search size={21} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, código ou CPF/CNPJ" /></label>
        <div className="client-picker-list">
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando sua carteira...</div> : filtered.map((client) => (
            <button key={client.CODPARC} onClick={() => onSelect(client)}>
              <span className="client-avatar"><Building2 size={20} /></span>
              <span><strong>{client.NOMEPARC}</strong><small>Cód. {client.CODPARC}{client.CGCCPF ? ` · ${client.CGCCPF}` : ""}</small></span>
              <ArrowRight size={18} />
            </button>
          ))}
          {!loading && !filtered.length && <div className="empty-state">Nenhum cliente encontrado na sua carteira.</div>}
        </div>
      </section>
    </div>
  );
}

function NewOrderV2({
  partner,
  draft,
  offlineData,
  online,
  onSaveDraft,
  onBack,
  onSent,
}: {
  partner: Partner;
  draft: OrderDraft | null;
  offlineData: OfflineSnapshot | null;
  online: boolean;
  onSaveDraft: (draft: OrderDraft) => void;
  onBack: () => void;
  onSent: (id: string | undefined, draftId: string) => void;
}) {
  const [draftId] = useState(() => draft?.id ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [phase, setPhase] = useState<OrderPhase>(draft?.phase ?? "header");
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [priceCode, setPriceCode] = useState(Number(draft?.priceCode || 0));
  const [negotiation, setNegotiation] = useState(Number(draft?.negotiation || 0));
  const [observation, setObservation] = useState(draft?.observation ?? "");
  const [cart, setCart] = useState<CartItem[]>(draft?.cart ?? []);
  const [brand, setBrand] = useState("");
  const [pendingBrand, setPendingBrand] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [pendingGroups, setPendingGroups] = useState<number[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<number[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [showGroupFilter, setShowGroupFilter] = useState(false);
  const [showBrandFilter, setShowBrandFilter] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedTable = tables.find((table) => Number(table.CODTAB) === priceCode);
  const selectedNegotiation = negotiations.find((item) => Number(item.CODTIPVENDA) === negotiation);
  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.VLRVENDA) * item.quantity, 0), [cart]);
  const totalUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  const goToPhase = (nextPhase: OrderPhase) => {
    if (nextPhase === phase) return;
    const current = window.history.state as AppHistoryState | null;
    window.history.pushState(
      { ...(current ?? {}), norteSulVendas: true, view: "new", phase: nextPhase } satisfies AppHistoryState,
      "",
      window.location.href,
    );
    setPhase(nextPhase);
  };

  const openSendConfirmation = () => {
    const current = window.history.state as AppHistoryState | null;
    window.history.pushState(
      { ...(current ?? {}), norteSulVendas: true, view: "new", phase, dialog: "send" } satisfies AppHistoryState,
      "",
      window.location.href,
    );
    setShowConfirm(true);
  };

  const openGroupFilter = () => {
    const current = window.history.state as AppHistoryState | null;
    setPendingGroups(selectedGroups);
    setGroupSearch("");
    setExpandedGroups([]);
    window.history.pushState(
      { ...(current ?? {}), norteSulVendas: true, view: "new", phase, dialog: "groups" } satisfies AppHistoryState,
      "",
      window.location.href,
    );
    setShowGroupFilter(true);
  };

  const openBrandFilter = () => {
    const current = window.history.state as AppHistoryState | null;
    setPendingBrand(brand);
    window.history.pushState(
      { ...(current ?? {}), norteSulVendas: true, view: "new", phase, dialog: "brand" } satisfies AppHistoryState,
      "",
      window.location.href,
    );
    setShowBrandFilter(true);
  };

  const closeGroupFilter = () => {
    const current = window.history.state as AppHistoryState | null;
    if (current?.dialog === "groups") window.history.back();
    else setShowGroupFilter(false);
  };

  const closeBrandFilter = () => {
    const current = window.history.state as AppHistoryState | null;
    if (current?.dialog === "brand") window.history.back();
    else setShowBrandFilter(false);
  };

  useEffect(() => {
    const initialPhase = draft?.phase ?? "header";
    const current = window.history.state as AppHistoryState | null;
    if (current?.norteSulVendas && current.view === "new") {
      window.history.replaceState({ ...current, phase: "header" } satisfies AppHistoryState, "", window.location.href);
      if (initialPhase === "products" || initialPhase === "review") {
        window.history.pushState({ ...current, phase: "products" } satisfies AppHistoryState, "", window.location.href);
      }
      if (initialPhase === "review") {
        window.history.pushState({ ...current, phase: "review" } satisfies AppHistoryState, "", window.location.href);
      }
    }

    const handlePhaseBack = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;
      if (state?.norteSulVendas && state.view === "new") {
        if (state.phase) setPhase(state.phase);
        setShowConfirm(state.dialog === "send");
        setShowGroupFilter(state.dialog === "groups");
        setShowBrandFilter(state.dialog === "brand");
      }
    };
    window.addEventListener("popstate", handlePhaseBack);
    return () => window.removeEventListener("popstate", handlePhaseBack);
  }, []);

  const applyOfflineOptions = () => {
    const cachedPartner = offlineData?.clients.find((item) => Number(item.CODPARC) === Number(partner.CODPARC));
    if (!offlineData || !cachedPartner) return false;
    const partnerTable = Number(cachedPartner.CODTAB || 0);
    const cachedTables = offlineData.tables
      .filter((table) => Number(table.CODTAB) === partnerTable) as PriceTable[];
    const cachedNegotiations = offlineData.negotiations as Negotiation[];
    setTables(cachedTables);
    setNegotiations(cachedNegotiations);
    if (!priceCode) setPriceCode(Number(cachedTables[0]?.CODTAB || 0));
    if (!negotiation) {
      const preferred = cachedNegotiations.find(
        (item) => Number(item.CODTIPVENDA) === Number(cachedPartner.CODTIPVENDA),
      );
      setNegotiation(Number(preferred?.CODTIPVENDA ?? cachedNegotiations[0]?.CODTIPVENDA ?? 0));
    }
    return true;
  };

  const offlineGroups = () => {
    if (!offlineData) return [] as ProductGroup[];
    const eligible = new Set(
      offlineData.products
        .filter((item) =>
          Number(item.CODTAB) === priceCode
          && (!brand || String(item.MARCA || "SEM MARCA").toUpperCase() === brand.toUpperCase()),
        )
        .map((item) => Number(item.CODGRUPOPROD)),
    );
    const availableGroups = (offlineData.productGroups ?? []).map((item) => ({
      CODGRUPOPROD: Number(item.CODGRUPOPROD),
      DESCRGRUPOPROD: String(item.DESCRGRUPOPROD || `Grupo ${item.CODGRUPOPROD}`),
      CODGRUPAI: Number(item.CODGRUPAI || 0),
      GRAU: Number(item.GRAU || 0),
      ANALITICO: String(item.ANALITICO || "S"),
      ELEGIVEL: eligible.has(Number(item.CODGRUPOPROD)) ? 1 : 0,
    }));
    const byCode = new Map(availableGroups.map((group) => [group.CODGRUPOPROD, group]));
    const visible = new Set<number>();
    eligible.forEach((code) => {
      let current = byCode.get(code);
      if (!current) {
        visible.add(code);
        return;
      }
      while (current && !visible.has(current.CODGRUPOPROD)) {
        visible.add(current.CODGRUPOPROD);
        current = byCode.get(Number(current.CODGRUPAI || 0));
      }
    });
    const hierarchy = availableGroups.filter((group) => visible.has(group.CODGRUPOPROD));
    if (hierarchy.length) return hierarchy;
    return [...eligible].map((code) => {
      const product = offlineData.products.find((item) => Number(item.CODGRUPOPROD) === code);
      return {
        CODGRUPOPROD: code,
        DESCRGRUPOPROD: String(product?.DESCRGRUPOPROD || `Grupo ${code}`),
        CODGRUPAI: 0,
        GRAU: 0,
        ANALITICO: "S",
        ELEGIVEL: 1,
      };
    });
  };

  const offlineBrands = () => {
    const values = new Set<string>();
    (offlineData?.products ?? [])
      .filter((item) => Number(item.CODTAB) === priceCode)
      .forEach((item) => values.add(String(item.MARCA || "SEM MARCA")));
    return [...values].sort((left, right) => left.localeCompare(right, "pt-BR")).map((MARCA) => ({ MARCA }));
  };

  const offlineProducts = () => {
    const term = normalizeProductSearch(search);
    const tokens = term.split(/\s+/).filter(Boolean);
    return (offlineData?.products ?? [])
      .filter((item) => {
        if (Number(item.CODTAB) !== priceCode) return false;
        if (term) {
          const searchable = normalizeProductSearch(
            `${item.DESCRPROD} ${item.CODPROD} ${item.REFERENCIA || ""} ${item.MARCA || ""}`,
          );
          return tokens.every((token) => searchable.includes(token));
        }
        return (
          (!selectedGroups.length || selectedGroups.includes(Number(item.CODGRUPOPROD)))
          && (!brand || String(item.MARCA || "SEM MARCA").toUpperCase() === brand.toUpperCase())
        );
      })
      .sort((left, right) => {
        if (!term) return String(left.DESCRPROD).localeCompare(String(right.DESCRPROD), "pt-BR");
        const leftCode = String(left.CODPROD);
        const rightCode = String(right.CODPROD);
        const relevance = (item: ApiRow, code: string) =>
          code === term ? 0
            : code.startsWith(term) ? 1
              : normalizeProductSearch(item.DESCRPROD).startsWith(term) ? 2 : 3;
        return relevance(left, leftCode) - relevance(right, rightCode)
          || String(left.DESCRPROD).localeCompare(String(right.DESCRPROD), "pt-BR");
      }) as Product[];
  };

  const currentDraft = (): OrderDraft => ({
    id: draftId,
    updatedAt: Date.now(),
    phase,
    partner,
    priceCode,
    priceName: selectedTable?.NOMETAB ?? draft?.priceName ?? "",
    negotiation,
    negotiationName: selectedNegotiation?.DESCRTIPVENDA ?? draft?.negotiationName ?? "",
    observation,
    cart,
  });

  useEffect(() => {
    setLoading(true);
    setError("");
    if (!online) {
      if (!applyOfflineOptions()) setError("Faça uma carga online antes de criar pedidos offline.");
      setLoading(false);
      return;
    }
    api<{ partner: ApiRow; tables: PriceTable[]; negotiations: Negotiation[] }>(
      `/api/sankhya/data?kind=orderOptions&partner=${partner.CODPARC}`,
    )
      .then((result) => {
        setTables(result.tables);
        setNegotiations(result.negotiations);
        if (!priceCode) {
          const preferred = result.tables.find((table) => Number(table.CODTAB) === Number(result.partner.CODTAB));
          setPriceCode(Number(preferred?.CODTAB ?? result.tables[0]?.CODTAB ?? 0));
        }
        if (!negotiation) {
          const preferred = result.negotiations.find((item) => Number(item.CODTIPVENDA) === Number(result.partner.CODTIPVENDA));
          setNegotiation(Number(preferred?.CODTIPVENDA ?? result.negotiations[0]?.CODTIPVENDA ?? 0));
        }
      })
      .catch((err) => {
        if (!applyOfflineOptions()) setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [partner.CODPARC, online, offlineData]);

  useEffect(() => {
    if (phase !== "products" || !priceCode) return;
    if (!online) {
      const cachedGroups = offlineGroups();
      setGroups(cachedGroups);
      setBrands(offlineBrands());
      setExpandedGroups([]);
      return;
    }
    api<{ rows: ProductGroup[]; brands: ProductBrand[] }>(
      `/api/sankhya/data?kind=productGroups&partner=${partner.CODPARC}&priceCode=${priceCode}&brand=${encodeURIComponent(brand)}`,
    )
      .then((result) => {
        setGroups(result.rows);
        setBrands(result.brands);
        setExpandedGroups([]);
      })
      .catch((err) => {
        const cached = offlineGroups();
        if (cached.length) setGroups(cached);
        else setError(err.message);
      });
  }, [phase, priceCode, brand, partner.CODPARC, online, offlineData]);

  useEffect(() => {
    if (phase !== "products" || (!selectedGroups.length && !brand && !search.trim())) {
      setProducts([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoadingProducts(true);
      setError("");
      if (!online) {
        setProducts(offlineProducts());
        setLoadingProducts(false);
        return;
      }
      const params = new URLSearchParams({
        kind: "products",
        partner: String(partner.CODPARC),
        priceCode: String(priceCode),
        groups: selectedGroups.join(","),
        brand,
        q: search,
      });
      api<{ rows: Product[] }>(`/api/sankhya/data?${params}`)
        .then((result) => setProducts(result.rows))
        .catch((err) => {
          const cached = offlineProducts();
          if (cached.length) setProducts(cached);
          else setError(err.message);
        })
        .finally(() => setLoadingProducts(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [phase, selectedGroups.join(","), brand, search, priceCode, partner.CODPARC, online, offlineData]);

  useEffect(() => {
    onSaveDraft(currentDraft());
  }, [phase, priceCode, negotiation, observation, cart]);

  const setQuantity = (product: Product, change: number) => {
    setCart((current) => {
      const existing = current.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE && item.CODLOCAL === product.CODLOCAL);
      const next = Math.max(0, Math.min(Number(product.DISPONIVEL), (existing?.quantity || 0) + change));
      if (!next) return current.filter((item) => item !== existing);
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: next } : item);
      return [...current, { ...product, quantity: next }];
    });
  };

  const quantityOf = (product: Product) =>
    cart.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE && item.CODLOCAL === product.CODLOCAL)?.quantity || 0;

  const clearProductFilters = () => {
    setBrand("");
    setPendingBrand("");
    setSelectedGroups([]);
    setPendingGroups([]);
    setExpandedGroups([]);
    setGroupSearch("");
    setSearch("");
    setProducts([]);
    setError("");
  };

  const groupsByParent = new Map<number, ProductGroup[]>();
  groups.forEach((group) => {
    const parent = Number(group.CODGRUPAI || 0);
    groupsByParent.set(parent, [...(groupsByParent.get(parent) ?? []), group]);
  });
  groupsByParent.forEach((items) =>
    items.sort((left, right) => left.DESCRGRUPOPROD.localeCompare(right.DESCRGRUPOPROD, "pt-BR")),
  );
  const groupCodes = new Set(groups.map((group) => Number(group.CODGRUPOPROD)));
  const rootGroups = groups.filter((group) => !groupCodes.has(Number(group.CODGRUPAI || 0)));

  const selectableInBranch = (code: number): number[] => {
    const current = groups.find((group) => Number(group.CODGRUPOPROD) === code);
    const own = Number(current?.ELEGIVEL || 0) === 1 ? [code] : [];
    return [
      ...own,
      ...(groupsByParent.get(code) ?? []).flatMap((child) => selectableInBranch(Number(child.CODGRUPOPROD))),
    ];
  };

  const togglePendingGroup = (code: number) => {
    const branch = selectableInBranch(code);
    const allSelected = branch.length > 0 && branch.every((item) => pendingGroups.includes(item));
    setPendingGroups((current) =>
      allSelected
        ? current.filter((item) => !branch.includes(item))
        : [...new Set([...current, ...branch])],
    );
  };

  const groupMatches = (group: ProductGroup): boolean => {
    const term = groupSearch.trim().toLocaleLowerCase("pt-BR");
    if (!term) return true;
    if (`${group.DESCRGRUPOPROD} ${group.CODGRUPOPROD}`.toLocaleLowerCase("pt-BR").includes(term)) return true;
    return (groupsByParent.get(Number(group.CODGRUPOPROD)) ?? []).some(groupMatches);
  };

  const renderGroupBranch = (group: ProductGroup, depth = 0): ReactNode => {
    if (!groupMatches(group)) return null;
    const code = Number(group.CODGRUPOPROD);
    const children = groupsByParent.get(code) ?? [];
    const isExpanded = expandedGroups.includes(code) || Boolean(groupSearch.trim());
    const selectable = selectableInBranch(code);
    const checked = selectable.length > 0 && selectable.every((item) => pendingGroups.includes(item));
    return (
      <div className="group-tree-branch" key={code}>
        <div className="group-tree-row" style={{ paddingLeft: `${depth * 22 + 6}px` }}>
          {children.length ? (
            <button
              className="tree-toggle"
              aria-label={isExpanded ? "Recolher grupo" : "Expandir grupo"}
              onClick={() => setExpandedGroups((current) =>
                current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
              )}
            >
              <ChevronDown className={isExpanded ? "" : "collapsed"} size={19} />
            </button>
          ) : <span className="tree-spacer" />}
          <button className="group-tree-label" onClick={() => togglePendingGroup(code)} disabled={!selectable.length}>
            <span>{group.DESCRGRUPOPROD}</span>
            <small>Cód. {code}</small>
          </button>
          <input
            type="checkbox"
            checked={checked}
            disabled={!selectable.length}
            aria-label={`Selecionar ${group.DESCRGRUPOPROD}`}
            onChange={() => togglePendingGroup(code)}
          />
        </div>
        {children.length > 0 && isExpanded && children.map((child) => renderGroupBranch(child, depth + 1))}
      </div>
    );
  };

  const closeOrder = () => {
    onSaveDraft(currentDraft());
    onBack();
  };

  const sendOrder = async () => {
    if (!online) {
      setError("O pedido foi mantido como rascunho. Conecte-se à internet para enviar ao Sankhya.");
      setShowConfirm(false);
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await api<{ orderId?: string }>("/api/sankhya/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner: partner.CODPARC,
          operation: 5,
          negotiation,
          priceCode,
          observation,
          items: cart.map((item) => ({
            product: Number(item.CODPROD),
            quantity: item.quantity,
            unitPrice: Number(item.VLRVENDA),
            volume: item.CODVOL,
            location: Number(item.CODLOCAL),
            control: item.CONTROLE,
            priceTable: Number(item.NUTAB),
          })),
        }),
      });
      onSent(result.orderId, draftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no envio.");
      const current = window.history.state as AppHistoryState | null;
      if (current?.dialog === "send") window.history.back();
      else setShowConfirm(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page new-order-page">
      <header className="new-header">
        <button className="back-button" onClick={closeOrder}><ArrowLeft size={20} /></button>
        <div><span className="eyebrow">Pedido de venda</span><h1>{draft ? "Continuar pedido" : "Novo pedido"}</h1></div>
        <span className="draft-saved"><FileText size={15} /> Rascunho automático</span>
        <span className={`sync-badge ${online ? "" : "offline"}`}>
          {online ? <CloudCheck size={16} /> : <CloudOff size={16} />}
          {online ? "Sankhya online" : "Modo offline"}
        </span>
      </header>

      <nav className="order-phase-nav" aria-label="Navegação do pedido">
        <button className={phase === "header" ? "active" : ""} onClick={() => goToPhase("header")}>
          <ClipboardList size={17} /><span><small>Pedido</small>Cabeçalho</span>
        </button>
        <ArrowRight className="phase-arrow" size={16} />
        <button className={phase === "products" ? "active" : ""} disabled={!priceCode || !negotiation} onClick={() => goToPhase("products")}>
          <ShoppingCart size={17} /><span><small>Seleção</small>Produtos</span>
        </button>
        <ArrowRight className="phase-arrow" size={16} />
        <button className={phase === "review" ? "active" : ""} disabled={!cart.length} onClick={() => goToPhase("review")}>
          <CheckCircle2 size={17} /><span><small>Finalização</small>Revisão</span>
        </button>
      </nav>

      <div className="new-content order-workspace">
        {phase === "header" && (
          <section className="form-section conditions">
            <div className="section-heading"><div><span className="eyebrow">Cabeçalho do pedido</span><h2>Condições comerciais</h2><p>Confira a tabela cadastrada para o cliente e escolha o tipo de negociação.</p></div></div>
            <div className="selected-client"><span className="client-avatar"><Building2 /></span><div><small>Cliente selecionado</small><strong>{partner.NOMEPARC}</strong><span>Cód. {partner.CODPARC}{partner.GRUPOICMS != null ? ` · Grupo ICMS ${partner.GRUPOICMS}` : ""}</span></div></div>
            {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando condições do Sankhya...</div> : (
              <div className="condition-grid">
                <label>Empresa<div className="select-field"><Building2 size={19} /><span>1 — Norte Sul Sementes</span><LockKeyhole size={15} /></div></label>
                <label>Tipo de operação<div className="select-field valid"><ClipboardList size={19} /><span>TOP 5 — Pedido de venda</span><CheckCircle2 size={16} /></div></label>
                <label>Tabela de preço
                  <select className="native-select" value={priceCode} onChange={(event) => {
                    setPriceCode(Number(event.target.value));
                    setBrand("");
                    setSelectedGroups([]);
                    setProducts([]);
                    setCart([]);
                  }}>
                    <option value={0}>Selecione a tabela</option>
                    {tables.map((table) => <option key={table.CODTAB} value={table.CODTAB}>{table.CODTAB} — {table.NOMETAB}</option>)}
                  </select>
                  <small>Tabela ativa cadastrada neste cliente para a empresa 1.</small>
                </label>
                <label>Tipo de negociação
                  <select className="native-select" value={negotiation} onChange={(event) => setNegotiation(Number(event.target.value))}>
                    <option value={0}>Selecione a negociação</option>
                    {negotiations.map((item) => <option key={item.CODTIPVENDA} value={item.CODTIPVENDA}>{item.CODTIPVENDA} — {item.DESCRTIPVENDA}</option>)}
                  </select>
                </label>
                <label className="observation-field">Observação<textarea value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Informações adicionais do pedido" /></label>
              </div>
            )}
            <div className="rule-card"><ShieldCheck size={22} /><div><strong>Regras do Sankhya aplicadas</strong><p>A carteira, o Grupo de ICMS, a tabela, a negociação e a TOP 5 serão revalidados antes do envio.</p></div></div>
          </section>
        )}

        {phase === "products" && (
          <section className="form-section products-section">
            <div className="compact-product-filters">
              <div className="product-filter-tabs" role="group" aria-label="Filtros dos produtos">
                <button className={brand ? "active" : ""} onClick={openBrandFilter}>
                  Marca{brand && <span className="filter-active-dot" />}
                </button>
                <span />
                <button className={selectedGroups.length ? "active" : ""} onClick={openGroupFilter}>
                  Grupo{selectedGroups.length > 0 && <small>{selectedGroups.length}</small>}
                </button>
              </div>
              {(brand || selectedGroups.length > 0 || search.trim()) && (
                <div className="product-filter-actions">
                  <button onClick={clearProductFilters}><X size={14} /> Limpar filtros</button>
                </div>
              )}
              <span className="search-box product-search">
                <Search size={22} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar..." aria-label="Pesquisar produto" />
                <SlidersHorizontal size={22} />
              </span>
            </div>
            <div className="product-list">
              {!selectedGroups.length && !brand && !search.trim() ? <div className="empty-state product-filter-empty"><Filter size={22} /> Selecione uma marca, grupo ou pesquise um produto</div> :
                loadingProducts ? <div className="empty-state"><LoaderCircle className="spin" /> Consultando tabela, estoque e mobilidade...</div> :
                  products.map((product) => (
                    <article key={`${product.CODPROD}-${product.CODLOCAL}-${product.CONTROLE}`} className={quantityOf(product) ? "selected" : ""}>
                      <span className="product-icon"><Sprout size={22} /></span>
                      <div className="product-info"><strong>{product.DESCRPROD}</strong><small>Cód. {product.CODPROD} · {product.CODVOL}{product.MARCA ? ` · ${product.MARCA}` : ""}</small><span><PackageCheck size={14} /> {Number(product.DISPONIVEL).toLocaleString("pt-BR")} disponíveis</span></div>
                      <div className="product-price"><strong>{money(Number(product.VLRVENDA))}</strong><small>por {product.CODVOL}</small></div>
                      {quantityOf(product) ? (
                        <div className="quantity"><button onClick={() => setQuantity(product, -1)}><Minus size={16} /></button><strong>{quantityOf(product)}</strong><button onClick={() => setQuantity(product, 1)}><Plus size={16} /></button></div>
                      ) : <button className="add-button" onClick={() => setQuantity(product, 1)}><Plus size={17} /> Adicionar</button>}
                    </article>
                  ))}
              {(selectedGroups.length > 0 || brand || search.trim()) && !loadingProducts && !products.length && <div className="empty-state">Nenhum produto elegível encontrado.</div>}
            </div>
          </section>
        )}

        {phase === "review" && (
          <section className="form-section review-section">
            <div className="section-heading"><div><span className="eyebrow">Revisão</span><h2>Revise seu pedido</h2><p>Confira as condições e os itens antes de validar o envio.</p></div></div>
            <div className="review-grid">
              <article className="review-client"><div className="review-title"><Building2 size={19} /><strong>Cliente e condições</strong><button onClick={() => goToPhase("header")}>Editar</button></div><h3>{partner.NOMEPARC}</h3><p>Cód. {partner.CODPARC}</p><dl><div><dt>Operação</dt><dd>TOP 5</dd></div><div><dt>Tabela</dt><dd>{selectedTable?.NOMETAB || priceCode}</dd></div><div><dt>Negociação</dt><dd>{selectedNegotiation?.DESCRTIPVENDA || negotiation}</dd></div></dl></article>
              <article className="review-items"><div className="review-title"><ShoppingCart size={19} /><strong>Itens do pedido</strong><button onClick={() => goToPhase("products")}>Editar</button></div>{cart.map((item) => <div className="review-item" key={`${item.CODPROD}-${item.CODLOCAL}-${item.CONTROLE}`}><span>{item.quantity}×</span><div><strong>{item.DESCRPROD}</strong><small>{money(Number(item.VLRVENDA))} / {item.CODVOL}</small></div><strong>{money(item.quantity * Number(item.VLRVENDA))}</strong></div>)}</article>
            </div>
            {observation && <div className="review-observation"><small>Observação</small><p>{observation}</p></div>}
            <div className="order-summary"><span><small>{totalUnits} {totalUnits === 1 ? "unidade" : "unidades"}</small><strong>Total do pedido</strong></span><strong>{money(total)}</strong></div>
            <div className="validation-strip"><span><CheckCircle2 /> Cliente e ICMS</span><span><CheckCircle2 /> Tabela vigente</span><span><CheckCircle2 /> Estoque e mobilidade</span><span><CheckCircle2 /> Negociação ativa</span></div>
            {!online && <div className="offline-order-notice"><CloudOff size={20} /><span><strong>Rascunho salvo offline</strong><small>Conecte-se à internet para validar os dados atuais e enviar ao Sankhya.</small></span></div>}
          </section>
        )}
        {error && <div className="global-error">{error}</div>}
      </div>

      <footer className="new-footer">
        <button className="secondary" onClick={phase === "header" ? closeOrder : () => window.history.back()}>Voltar</button>
        <div className="footer-total">{phase !== "header" && <><small>{totalUnits} itens</small><strong>{money(total)}</strong></>}</div>
        <button className="primary" disabled={(phase === "header" && (!priceCode || !negotiation || loading)) || (phase === "products" && !cart.length) || (phase === "review" && !online)} onClick={() => {
          if (phase === "header") goToPhase("products");
          else if (phase === "products") goToPhase("review");
          else openSendConfirmation();
        }}>
          {phase === "review"
            ? online
              ? <><ShieldCheck size={18} /> Validar e enviar</>
              : <><CloudOff size={18} /> Aguardando internet</>
            : <>Continuar <ArrowRight size={18} /></>}
        </button>
      </footer>

      {showBrandFilter && (
        <div className="modal-backdrop group-filter-backdrop">
          <div className="brand-filter-modal">
            <header>
              <div><span className="eyebrow">Filtrar produtos</span><h2>Marca</h2></div>
              <button className="modal-close" onClick={closeBrandFilter}><X size={20} /></button>
            </header>
            <div className="brand-filter-list">
              <button className={!pendingBrand ? "selected" : ""} onClick={() => setPendingBrand("")}>
                <span>Todas as marcas</span>{!pendingBrand && <Check size={19} />}
              </button>
              {brands.map((item) => (
                <button className={pendingBrand === item.MARCA ? "selected" : ""} key={item.MARCA} onClick={() => setPendingBrand(item.MARCA)}>
                  <span>{item.MARCA}</span>{pendingBrand === item.MARCA && <Check size={19} />}
                </button>
              ))}
            </div>
            <footer>
              <button className="secondary" onClick={closeBrandFilter}>Cancelar</button>
              <button className="primary" onClick={() => {
                setBrand(pendingBrand);
                setSelectedGroups([]);
                setPendingGroups([]);
                setProducts([]);
                closeBrandFilter();
              }}>Aplicar</button>
            </footer>
          </div>
        </div>
      )}

      {showGroupFilter && (
        <div className="modal-backdrop group-filter-backdrop">
          <div className="group-filter-modal">
            <header>
              <div>
                <span className="eyebrow">Filtrar produtos</span>
                <h2>Filtrar por grupo</h2>
                <p>Selecione um ou mais grupos. Os níveis seguem a hierarquia cadastrada no Sankhya.</p>
              </div>
              <button className="modal-close" onClick={closeGroupFilter}><X size={20} /></button>
            </header>
            {brand && <div className="active-brand-filter"><Leaf size={16} /> Marca: <strong>{brand}</strong></div>}
            <span className="search-box group-search">
              <Search size={20} />
              <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Procurar grupo..." autoFocus />
            </span>
            <div className="group-tree">
              {rootGroups.length
                ? rootGroups.map((group) => renderGroupBranch(group))
                : <div className="empty-state">Nenhum grupo disponível para esta marca e tabela.</div>}
            </div>
            <footer>
              <span>{pendingGroups.length} {pendingGroups.length === 1 ? "grupo selecionado" : "grupos selecionados"}</span>
              <div className="modal-actions">
                <button className="secondary" onClick={closeGroupFilter}>Cancelar</button>
                <button className="primary" onClick={() => {
                  setSelectedGroups(pendingGroups);
                  setProducts([]);
                  closeGroupFilter();
                }}>Aplicar filtros</button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="modal-backdrop">
          <div className="confirm-modal">
            <button className="modal-close" onClick={() => window.history.back()}><X size={20} /></button>
            <span className="confirm-icon"><Send size={27} /></span>
            <h2>Enviar pedido ao Sankhya?</h2>
            <p>O cliente, a tabela, a negociação, os preços, o estoque e a TOP 5 serão validados novamente.</p>
            <div className="confirm-summary"><span><small>Cliente</small><strong>{partner.NOMEPARC}</strong></span><span><small>Total</small><strong>{money(total)}</strong></span></div>
            <div className="modal-actions"><button className="secondary" onClick={() => window.history.back()}>Revisar</button><button className="primary" onClick={sendOrder} disabled={sending}>{sending ? <LoaderCircle className="spin" /> : <><Send size={18} /> Confirmar envio</>}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewOrder({ onBack, onSent }: { onBack: () => void; onSent: (id?: string) => void }) {
  const [step, setStep] = useState(1);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [observation, setObservation] = useState("");

  useEffect(() => {
    if (step !== 1) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api<{ rows: Partner[] }>(`/api/sankhya/data?kind=partners&q=${encodeURIComponent(search)}`)
        .then((result) => setPartners(result.rows))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, step]);

  useEffect(() => {
    if (step !== 3 || !selectedPartner) return;
    setLoading(true);
    setError("");
    api<{ rows: Product[] }>(`/api/sankhya/data?kind=products&partner=${selectedPartner.CODPARC}&q=${encodeURIComponent(search)}`)
      .then((result) => setProducts(result.rows))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [step, selectedPartner, search]);

  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.VLRVENDA) * item.quantity, 0), [cart]);
  const totalUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  const setQuantity = (product: Product, change: number) => {
    setCart((current) => {
      const existing = current.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE);
      const next = Math.max(0, Math.min(Number(product.DISPONIVEL), (existing?.quantity || 0) + change));
      if (!next) return current.filter((item) => !(item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE));
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: next } : item);
      return [...current, { ...product, quantity: next }];
    });
  };

  const quantityOf = (product: Product) =>
    cart.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE)?.quantity || 0;

  const sendOrder = async () => {
    if (!selectedPartner) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ orderId?: string }>("/api/sankhya/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner: selectedPartner.CODPARC,
          operation: 5,
          observation,
          items: cart.map((item) => ({
            product: Number(item.CODPROD),
            quantity: item.quantity,
            unitPrice: Number(item.VLRVENDA),
            volume: item.CODVOL,
            location: Number(item.CODLOCAL),
            control: item.CONTROLE,
            priceTable: Number(item.NUTAB),
          })),
        }),
      });
      onSent(result.orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no envio.");
      setShowConfirm(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page new-order-page">
      <header className="new-header">
        <button className="back-button" onClick={step === 1 ? onBack : () => setStep(step - 1)}><ArrowLeft size={20} /></button>
        <div><span className="eyebrow">Pedido de venda</span><h1>Novo pedido</h1></div>
        <span className="sync-badge"><CloudCheck size={16} /> Sankhya online</span>
      </header>
      <div className="stepper">
        {["Cliente", "Condições", "Produtos", "Revisão"].map((label, index) => (
          <div key={label} className={`${step === index + 1 ? "active" : ""} ${step > index + 1 ? "done" : ""}`}>
            <span>{step > index + 1 ? <Check size={15} /> : index + 1}</span><small>{label}</small>
          </div>
        ))}
      </div>

      <div className="new-content">
        {step === 1 && (
          <section className="form-section">
            <div className="section-heading"><div><span className="eyebrow">Etapa 1 de 4</span><h2>Para quem é o pedido?</h2><p>Selecione um cliente ativo com configuração comercial válida.</p></div></div>
            <label className="search-box wide"><Search size={21} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou código" /></label>
            <div className="partner-list">
              {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Buscando clientes...</div> : partners.filter((p) => `${p.NOMEPARC} ${p.CODPARC}`.toLowerCase().includes(search.toLowerCase())).slice(0, 18).map((partner) => (
                <button key={partner.CODPARC} className={selectedPartner?.CODPARC === partner.CODPARC ? "selected" : ""} onClick={() => setSelectedPartner(partner)}>
                  <span className="client-avatar"><Building2 size={20} /></span>
                  <span><strong>{partner.NOMEPARC}</strong><small>Cód. {partner.CODPARC} · Grupo ICMS {partner.GRUPOICMS}</small></span>
                  <span className="radio">{selectedPartner?.CODPARC === partner.CODPARC && <Check size={15} />}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && selectedPartner && (
          <section className="form-section conditions">
            <div className="section-heading"><div><span className="eyebrow">Etapa 2 de 4</span><h2>Condições comerciais</h2><p>Os dados abaixo vêm da configuração atual do Sankhya.</p></div></div>
            <div className="selected-client"><span className="client-avatar"><Building2 /></span><div><small>Cliente selecionado</small><strong>{selectedPartner.NOMEPARC}</strong><span>Cód. {selectedPartner.CODPARC}</span></div><button onClick={() => setStep(1)}>Alterar</button></div>
            <div className="condition-grid">
              <label>Empresa<div className="select-field"><Building2 size={19} /><span>1 — Norte Sul Sementes</span><LockKeyhole size={15} /></div></label>
              <label>Tipo de operação<div className="select-field valid"><ClipboardList size={19} /><span>TOP 5 — Pedido de venda</span><CheckCircle2 size={16} /></div></label>
              <label>Tabela de preço<div className="select-field valid"><CircleDollarSign size={19} /><span>Tabela {selectedPartner.CODTAB}</span><CheckCircle2 size={16} /></div><small>Definida pelo Grupo ICMS {selectedPartner.GRUPOICMS}</small></label>
              <label>Observação<textarea value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Informações adicionais do pedido" /></label>
            </div>
            <div className="rule-card"><ShieldCheck size={22} /><div><strong>Regras do Sankhya aplicadas</strong><p>A empresa, o vendedor, a negociação e a tabela são revalidados antes do envio.</p></div></div>
          </section>
        )}

        {step === 3 && selectedPartner && (
          <section className="form-section products-section">
            <div className="section-heading"><div><span className="eyebrow">Etapa 3 de 4</span><h2>Adicionar produtos</h2><p>Somente itens com estoque disponível e mobilidade ativa.</p></div><span className="table-tag">Tabela {selectedPartner.CODTAB}</span></div>
            <label className="search-box wide"><Search size={21} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto por nome ou código" /></label>
            <div className="product-list">
              {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Consultando estoque e preços...</div> : products.map((product) => (
                <article key={`${product.CODPROD}-${product.CONTROLE}`} className={quantityOf(product) ? "selected" : ""}>
                  <span className="product-icon"><Sprout size={22} /></span>
                  <div className="product-info"><strong>{product.DESCRPROD}</strong><small>Cód. {product.CODPROD} · {product.CODVOL}</small><span><PackageCheck size={14} /> {Number(product.DISPONIVEL).toLocaleString("pt-BR")} disponíveis</span></div>
                  <div className="product-price"><strong>{money(Number(product.VLRVENDA))}</strong><small>por {product.CODVOL}</small></div>
                  {quantityOf(product) ? (
                    <div className="quantity"><button onClick={() => setQuantity(product, -1)}><Minus size={16} /></button><strong>{quantityOf(product)}</strong><button onClick={() => setQuantity(product, 1)}><Plus size={16} /></button></div>
                  ) : <button className="add-button" onClick={() => setQuantity(product, 1)}><Plus size={17} /> Adicionar</button>}
                </article>
              ))}
              {!loading && !products.length && <div className="empty-state">Nenhum produto elegível encontrado para esta tabela.</div>}
            </div>
          </section>
        )}

        {step === 4 && selectedPartner && (
          <section className="form-section review-section">
            <div className="section-heading"><div><span className="eyebrow">Etapa 4 de 4</span><h2>Revise seu pedido</h2><p>Confira os dados antes de preparar o envio.</p></div></div>
            <div className="review-grid">
              <article className="review-client"><div className="review-title"><Building2 size={19} /><strong>Cliente e condições</strong><button onClick={() => setStep(2)}>Editar</button></div><h3>{selectedPartner.NOMEPARC}</h3><p>Cód. {selectedPartner.CODPARC}</p><dl><div><dt>Operação</dt><dd>TOP 5</dd></div><div><dt>Tabela</dt><dd>{selectedPartner.CODTAB}</dd></div><div><dt>Empresa</dt><dd>1</dd></div></dl></article>
              <article className="review-items"><div className="review-title"><ShoppingCart size={19} /><strong>Itens do pedido</strong><button onClick={() => setStep(3)}>Editar</button></div>{cart.map((item) => <div className="review-item" key={`${item.CODPROD}-${item.CONTROLE}`}><span>{item.quantity}×</span><div><strong>{item.DESCRPROD}</strong><small>{money(Number(item.VLRVENDA))} / {item.CODVOL}</small></div><strong>{money(item.quantity * Number(item.VLRVENDA))}</strong></div>)}</article>
            </div>
            <div className="order-summary"><span><small>{totalUnits} {totalUnits === 1 ? "unidade" : "unidades"}</small><strong>Total do pedido</strong></span><strong>{money(total)}</strong></div>
            <div className="validation-strip"><span><CheckCircle2 /> Cliente e Grupo ICMS</span><span><CheckCircle2 /> TOP 5 vigente</span><span><CheckCircle2 /> Estoque e mobilidade</span><span><CheckCircle2 /> Preços da tabela</span></div>
          </section>
        )}
        {error && <div className="global-error">{error}</div>}
      </div>

      <footer className="new-footer">
        <button className="secondary" onClick={step === 1 ? onBack : () => setStep(step - 1)}>Voltar</button>
        <div className="footer-total">{step >= 3 && <><small>{totalUnits} itens</small><strong>{money(total)}</strong></>}</div>
        <button className="primary" disabled={(step === 1 && !selectedPartner) || (step === 3 && !cart.length)} onClick={() => {
          if (step < 4) {
            if (step === 1) setSearch("");
            setStep(step + 1);
          } else {
            setShowConfirm(true);
          }
        }}>
          {step === 4 ? <><ShieldCheck size={18} /> Validar e enviar</> : <>Continuar <ArrowRight size={18} /></>}
        </button>
      </footer>

      {showConfirm && (
        <div className="modal-backdrop">
          <div className="confirm-modal">
            <button className="modal-close" onClick={() => setShowConfirm(false)}><X size={20} /></button>
            <span className="confirm-icon"><Send size={27} /></span>
            <h2>Enviar pedido ao Sankhya?</h2>
            <p>Uma última validação será feita no estoque, no Grupo de ICMS, na tabela de preço e na TOP 5.</p>
            <div className="confirm-summary"><span><small>Cliente</small><strong>{selectedPartner?.NOMEPARC}</strong></span><span><small>Total</small><strong>{money(total)}</strong></span></div>
            <div className="modal-actions"><button className="secondary" onClick={() => setShowConfirm(false)}>Revisar</button><button className="primary" onClick={sendOrder} disabled={sending}>{sending ? <LoaderCircle className="spin" /> : <><Send size={18} /> Confirmar envio</>}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileNav({
  active,
  onHome,
  canMonitorSales,
  onGeneralSales,
  onOrders,
  onClients,
  onCommunication,
  unreadMessages,
  onMore,
}: {
  active: Exclude<AppScreen, "new">;
  onHome: () => void;
  canMonitorSales: boolean;
  onGeneralSales: () => void;
  onOrders: () => void;
  onClients: () => void;
  onCommunication: () => void;
  unreadMessages: number;
  onMore: () => void;
}) {
  return (
    <nav className={`mobile-nav ${canMonitorSales ? "management" : ""}`}>
      <button className={active === "home" ? "active" : ""} onClick={onHome}><Home /><span>Início</span></button>
      {canMonitorSales && (
        <button className={active === "general-sales" ? "active" : ""} onClick={onGeneralSales}>
          <CircleDollarSign /><span>Vendas</span>
        </button>
      )}
      <button className={active === "orders" ? "active" : ""} onClick={onOrders}><ShoppingBag /><span>Pedidos</span></button>
      <button className={active === "clients" ? "active" : ""} onClick={onClients}><UsersRound /><span>Clientes</span></button>
      <button className={active === "communication" ? "active" : ""} onClick={onCommunication}>
        <span className="mobile-nav-icon"><MessageCircle />{unreadMessages > 0 && <strong className="nav-unread-badge">{unreadMessages}</strong>}</span>
        <span>Comunicação</span>
      </button>
      <button className={active === "more" ? "active" : ""} onClick={onMore}><Menu /><span>Mais</span></button>
    </nav>
  );
}
