import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ImageReading } from "./types";

const SYSTEM = `Você confere prints de fim de partida de Warzone (interface em português) para um campeonato.
Sua única tarefa é transcrever o que está visível. Regras obrigatórias:

1. NUNCA invente, deduza ou estime um valor. Se um número ou nome não estiver nítido, retorne null naquele campo e explique em "notes". Um null é sempre melhor que um chute.
2. Classifique cada imagem:
   - PLACEMENT: tela de resultado. Mostra "VITÓRIA" em destaque (colocação 1) ou a colocação do time (ex.: "2º", "5º LUGAR").
   - STATS: placar do esquadrão em tabela, com cabeçalhos como NVL, NOME, PONTUAÇÃO, ELIMINAÇÕES, BAIXAS, ASSIST., REMOBILIZAÇÕES, DANO.
   - UNKNOWN: qualquer outra coisa, ou imagem sem leitura segura.
3. Em imagens PLACEMENT: informe apenas colocação e vitória. As estatísticas individuais no rodapé (eliminações, baixas, mortes, dano) pertencem só a quem tirou a print: ignore-as e deixe "players" vazio.
4. Em imagens STATS:
   a. Transcreva em "headers" os cabeçalhos das colunas, da esquerda para a direita, exatamente como aparecem.
   b. Localize o cabeçalho "BAIXAS". Para cada jogador, leia o número alinhado verticalmente sob esse cabeçalho.
   c. "ELIMINAÇÕES" é OUTRA coluna, normalmente à esquerda de BAIXAS, e NÃO deve ser usada. Não use também PONTUAÇÃO, ASSIST., REMOBILIZAÇÕES, DANO ou mortes.
   d. Em "squadTotalBaixas", leia o valor da linha de total do esquadrão na coluna BAIXAS. Não some você mesmo: se a linha de total não estiver visível ou legível, retorne null.
   e. Em "detectedName", copie o nome do jogador exatamente como aparece, incluindo clan tag.
   f. Se não existir uma coluna com o cabeçalho BAIXAS visível, retorne null em todas as baixas.
5. "confidence" vai de 0 a 1 e representa a sua certeza real sobre a leitura. Imagem cortada, borrada, fotografada de tela com reflexo ou com números encobertos deve receber confiança baixa.`;

const TOOL: Anthropic.Tool = {
  name: "registrar_leitura",
  description: "Registra a leitura estruturada de cada imagem enviada, na mesma ordem.",
  input_schema: {
    type: "object",
    required: ["images"],
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "type", "placement", "victory", "headers", "players", "squadTotalBaixas", "confidence", "notes"],
          properties: {
            index: { type: "integer", description: "Posição da imagem na mensagem, começando em 0." },
            type: { type: "string", enum: ["PLACEMENT", "STATS", "UNKNOWN"] },
            placement: { type: ["integer", "null"], description: "Colocação do time. 1 quando a tela mostra VITÓRIA. null se não legível ou se a imagem não é PLACEMENT." },
            victory: { type: "boolean", description: "true somente se a palavra VITÓRIA aparece em destaque." },
            headers: { type: "array", items: { type: "string" }, description: "Cabeçalhos das colunas do placar, da esquerda para a direita. Vazio se não for STATS." },
            players: {
              type: "array",
              items: {
                type: "object",
                required: ["detectedName", "baixas", "confidence"],
                properties: {
                  detectedName: { type: "string" },
                  baixas: { type: ["integer", "null"], description: "Valor da coluna BAIXAS deste jogador. null se não legível." },
                  confidence: { type: "number" },
                },
              },
            },
            squadTotalBaixas: { type: ["integer", "null"], description: "Linha de total do esquadrão, coluna BAIXAS. null se ausente ou ilegível." },
            confidence: { type: "number" },
            notes: { type: "string", description: "Observações curtas; obrigatório explicar cada null." },
          },
        },
      },
    },
  },
};

export type VisionImage = { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" };

/** Lê as prints com o Claude. Lança erro se a API falhar: quem chama trata como EM ANÁLISE. */
export async function readScreenshots(images: VisionImage[]): Promise<ImageReading[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 22_000 });
  const content: Anthropic.ContentBlockParam[] = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Imagem ${i}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
    });
  });
  content.push({
    type: "text",
    text: `Leia as ${images.length} imagens acima e registre o resultado com a ferramenta registrar_leitura. As imagens podem estar em qualquer ordem.`,
  });

  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 2000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("A IA não retornou uma leitura estruturada.");
  const raw = (block.input as { images?: unknown[] }).images;
  if (!Array.isArray(raw)) throw new Error("Leitura da IA em formato inesperado.");
  return raw.map((r, i) => sanitize(r as Record<string, unknown>, i));
}

const clamp01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const intOrNull = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function sanitize(r: Record<string, unknown>, i: number): ImageReading {
  const type = r.type === "PLACEMENT" || r.type === "STATS" ? r.type : "UNKNOWN";
  const players = Array.isArray(r.players) ? (r.players as Record<string, unknown>[]) : [];
  return {
    index: typeof r.index === "number" ? r.index : i,
    type,
    placement: type === "PLACEMENT" ? intOrNull(r.placement) : null,
    victory: type === "PLACEMENT" && r.victory === true,
    headers: Array.isArray(r.headers) ? r.headers.map(String) : [],
    players:
      type === "STATS"
        ? players.map((p) => ({
            detectedName: String(p.detectedName ?? ""),
            baixas: intOrNull(p.baixas),
            confidence: clamp01(p.confidence),
          }))
        : [],
    squadTotalBaixas: type === "STATS" ? intOrNull(r.squadTotalBaixas) : null,
    confidence: clamp01(r.confidence),
    notes: String(r.notes ?? ""),
  };
}
