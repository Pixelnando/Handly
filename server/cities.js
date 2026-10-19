// Base local de municípios (nome, UF, latitude, longitude aproximadas) para busca por proximidade
// sem depender de serviços externos de geocodificação (RNF08.3).
import { normText } from './util.js';

export const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

const RAW = `
Ourinhos|SP|-22.9791|-49.8697
Chavantes|SP|-23.0386|-49.7101
Salto Grande|SP|-22.8955|-49.9822
Santa Cruz do Rio Pardo|SP|-22.8986|-49.6330
Ipaussu|SP|-23.0586|-49.6264
Canitar|SP|-23.0033|-49.7842
Assis|SP|-22.6619|-50.4122
Marília|SP|-22.2139|-49.9458
Bauru|SP|-22.3147|-49.0587
Piraju|SP|-23.1925|-49.3847
Avaré|SP|-23.0989|-48.9258
Botucatu|SP|-22.8837|-48.4437
Presidente Prudente|SP|-22.1207|-51.3925
Jacarezinho|PR|-23.1597|-49.9695
Cambará|PR|-23.0003|-50.0434
Londrina|PR|-23.3103|-51.1628
São Paulo|SP|-23.5505|-46.6333
Campinas|SP|-22.9099|-47.0626
Santos|SP|-23.9608|-46.3336
Ribeirão Preto|SP|-21.1775|-47.8103
São José do Rio Preto|SP|-20.8113|-49.3758
Sorocaba|SP|-23.5015|-47.4526
Jundiaí|SP|-23.1857|-46.8978
Piracicaba|SP|-22.7253|-47.6492
São Carlos|SP|-22.0175|-47.8908
Araraquara|SP|-21.7845|-48.1780
Franca|SP|-20.5386|-47.4008
Guarulhos|SP|-23.4543|-46.5337
Osasco|SP|-23.5329|-46.7917
Santo André|SP|-23.6737|-46.5432
São Bernardo do Campo|SP|-23.6914|-46.5646
Taubaté|SP|-23.0264|-45.5558
São José dos Campos|SP|-23.2237|-45.9009
Limeira|SP|-22.5647|-47.4017
Rio de Janeiro|RJ|-22.9068|-43.1729
Niterói|RJ|-22.8832|-43.1034
Belo Horizonte|MG|-19.9167|-43.9345
Uberlândia|MG|-18.9186|-48.2772
Juiz de Fora|MG|-21.7642|-43.3503
Curitiba|PR|-25.4284|-49.2733
Maringá|PR|-23.4205|-51.9331
Ponta Grossa|PR|-25.0916|-50.1668
Cascavel|PR|-24.9578|-53.4595
Foz do Iguaçu|PR|-25.5163|-54.5854
Porto Alegre|RS|-30.0346|-51.2177
Caxias do Sul|RS|-29.1678|-51.1794
Florianópolis|SC|-27.5954|-48.5480
Joinville|SC|-26.3045|-48.8487
Blumenau|SC|-26.9194|-49.0661
Vitória|ES|-20.3155|-40.3128
Salvador|BA|-12.9777|-38.5016
Feira de Santana|BA|-12.2664|-38.9663
Recife|PE|-8.0476|-34.8770
Fortaleza|CE|-3.7319|-38.5267
Natal|RN|-5.7945|-35.2110
João Pessoa|PB|-7.1195|-34.8450
Maceió|AL|-9.6498|-35.7089
Aracaju|SE|-10.9472|-37.0731
São Luís|MA|-2.5307|-44.3068
Teresina|PI|-5.0892|-42.8019
Belém|PA|-1.4558|-48.4902
Manaus|AM|-3.1190|-60.0217
Macapá|AP|0.0349|-51.0694
Boa Vista|RR|2.8235|-60.6758
Porto Velho|RO|-8.7612|-63.9039
Rio Branco|AC|-9.9747|-67.8100
Palmas|TO|-10.1689|-48.3317
Goiânia|GO|-16.6869|-49.2648
Brasília|DF|-15.7939|-47.8828
Cuiabá|MT|-15.6014|-56.0979
Campo Grande|MS|-20.4697|-54.6201
Dourados|MS|-22.2231|-54.8120
`;

export const CITIES = RAW.trim().split('\n').map((l) => { const [name, uf, la, ln] = l.split('|'); return { name, uf, lat: parseFloat(la), lng: parseFloat(ln) }; });
const INDEX = new Map(CITIES.map((c) => [`${normText(c.name)}|${c.uf}`, c]));

export const findCity = (name, uf) => INDEX.get(`${normText(name)}|${String(uf || '').toUpperCase()}`) || null;

export function searchCities(q, limit = 10) {
  q = normText(q);
  if (!q) return CITIES.slice(0, limit);
  const starts = CITIES.filter((c) => normText(c.name).startsWith(q));
  const contains = CITIES.filter((c) => normText(c.name).includes(q) && !starts.includes(c));
  return [...starts, ...contains].slice(0, limit);
}
