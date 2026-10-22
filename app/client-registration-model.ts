export type ClientContact = { name: string; phone: string; mobile: string; email: string; role: string };
export type ClientRegistration = {
  requestId: string; sellerId: number; personType: 'J' | 'F'; document: string; stateRegistration: string;
  tradeName: string; legalName: string; phone: string; mobile: string; email: string; invoiceEmail: string;
  profileId: number; contacts: ClientContact[];
  postalCode: string; street: string; number: string; complement: string; neighborhood: string;
  cityId: number; city: string; state: string; fiscalMunicipality: string;
};
export const digits = (value: string) => value.replace(/\D/g, '');
export const cleanDocument = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const emptyContact = (): ClientContact => ({ name: '', phone: '', mobile: '', email: '', role: '' });
export function emptyClientRegistration(sellerId: number, requestId: string): ClientRegistration {
  return { requestId, sellerId, personType: 'J', document: '', stateRegistration: '', tradeName: '', legalName: '',
    phone: '', mobile: '', email: '', invoiceEmail: '', profileId: 0, contacts: [emptyContact()],
    postalCode: '', street: '', number: '', complement: '', neighborhood: '', cityId: 0, city: '', state: '', fiscalMunicipality: '' };
}

const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const phoneValid = (value: string) => /^\d{8,13}$/.test(digits(value));
const mobileValid = (value: string) => /^\d{10,13}$/.test(digits(value));
export function validateClientStep(data: ClientRegistration, step: number): string | null {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  if (step === 0) {
    if (!['J', 'F'].includes(data.personType)) return 'Selecione pessoa física ou jurídica.';
    if (!text(data.tradeName)) return 'Informe o nome fantasia do cliente.';
    if (!text(data.legalName)) return 'Informe a razão social do cliente.';
    if (!text(data.phone)) return 'Informe o telefone do cliente com DDD.';
    if (!phoneValid(text(data.phone))) return `Telefone inválido: foram informados ${digits(text(data.phone)).length} dígitos. Informe um telefone de 8 a 13 dígitos.`;
    for (const [value, max, label] of [[data.tradeName, 60, 'Nome fantasia'], [data.legalName, 60, 'Razão social'], [data.stateRegistration, 17, 'Inscrição estadual']] as const) {
      if (text(value).length > max) return `${label}: limite de ${max} caracteres.`;
    }
    const document = cleanDocument(text(data.document));
    if (document && !(data.personType === 'J' ? /^[A-Z0-9]{12}\d{2}$/.test(document) : /^\d{11}$/.test(document))) return 'Confira o CPF/CNPJ informado.';
    if (text(data.mobile) && !mobileValid(text(data.mobile))) return 'Confira o celular com DDD.';
    if ((text(data.email) && (!emailValid(data.email) || data.email.length > 80)) || (text(data.invoiceEmail) && (!emailValid(data.invoiceEmail) || data.invoiceEmail.length > 255))) return 'Confira os e-mails dos dados básicos.';
  }
  if (step === 1 && (!Number.isSafeInteger(data.profileId) || data.profileId <= 0)) return 'Selecione o perfil principal do cliente.';
  if (step === 2) {
    if (!Array.isArray(data.contacts) || data.contacts.length < 1 || data.contacts.length > 20) return 'Adicione pelo menos um contato (máximo de 20).';
    for (const contact of data.contacts) {
      if (!contact || !text(contact.name) || !phoneValid(text(contact.phone)) || !emailValid(text(contact.email)) || !text(contact.role)) return 'Cada contato precisa de nome, telefone com DDD, e-mail e cargo.';
      if (contact.name.length > 40 || contact.role.length > 20 || contact.email.length > 80) return 'Contato: nome até 40, cargo até 20 e e-mail até 80 caracteres.';
      if (text(contact.mobile) && !mobileValid(contact.mobile)) return 'Confira o celular dos contatos.';
    }
  }
  if (step === 3) {
    if (!/^\d{8}$/.test(digits(text(data.postalCode)))) return 'Informe um CEP com 8 dígitos.';
    if (!text(data.street) || !text(data.neighborhood) || !text(data.number)) return 'Informe endereço, bairro e número (ou S/N).';
    if (!Number.isSafeInteger(data.cityId) || data.cityId < 0 || !text(data.city) || data.city.length > 50 || !/^[A-Z]{2}$/.test(text(data.state))) return 'Informe uma cidade válida e seu estado.';
    if (data.street.length > 60 || data.neighborhood.length > 50 || data.number.length > 15 || data.complement.length > 60) return 'Confira os limites do endereço: logradouro 60, bairro 50, número 15 e complemento 60 caracteres.';
  }
  return null;
}

export function validateClientRegistration(value: unknown): ClientRegistration {
  if (!value || typeof value !== 'object') throw new Error('Cadastro inválido.');
  const data = value as ClientRegistration;
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(data.requestId || '') || !Number.isSafeInteger(data.sellerId) || data.sellerId <= 0) throw new Error('Identificação do cadastro ou vendedor inválido.');
  // Não aceita objetos nos campos de texto vindos do navegador.
  const template = emptyClientRegistration(data.sellerId, data.requestId);
  for (const key of Object.keys(template) as (keyof ClientRegistration)[]) {
    if (typeof template[key] === 'string' && typeof data[key] !== 'string') throw new Error('Preencha os campos do cadastro corretamente.');
  }
  if (!Array.isArray(data.contacts) || data.contacts.some(c => !c || Object.keys(emptyContact()).some(key => typeof c[key as keyof ClientContact] !== 'string'))) throw new Error('Contatos inválidos.');
  for (let step = 0; step < 4; step++) {
    const error = validateClientStep(data, step);
    if (error) throw new Error(error);
  }
  return { ...data, document: cleanDocument(data.document), phone: digits(data.phone), mobile: digits(data.mobile), postalCode: digits(data.postalCode),
    contacts: data.contacts.map(c => ({ ...c, name: c.name.trim(), role: c.role.trim(), email: c.email.trim(), phone: digits(c.phone), mobile: digits(c.mobile) })) };
}
