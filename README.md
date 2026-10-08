# Warzone Cup

Aplicação web para o campeonato semanal de Warzone: reports por print, leitura automática com IA,
pontuação, validação, classificação em tempo real, painel do administrador, área do capitão e modo transmissão.

Stack: Next.js 16 (React 19, TypeScript, Tailwind 4), Supabase (PostgreSQL, Auth, Storage, Realtime),
Claude (Anthropic) para a leitura das prints, deploy na Vercel.

## Publicar (cerca de 20 minutos)

### 1. Supabase
1. Crie um projeto em https://supabase.com (região São Paulo).
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase/migrations/0001_init.sql` e clique em **Run**.
   Isso cria tabelas, permissões (RLS), funções de pontuação, o bucket privado `prints` e liga o tempo real.
3. Em **Project Settings → API**, copie: Project URL, chave `anon` (ou publishable) e chave `service_role` (ou secret).

### 2. Anthropic
Crie uma chave em https://console.anthropic.com (API Keys) e coloque crédito na conta.
Cada report usa uma chamada com duas imagens; um domingo completo são 96 chamadas.

### 3. Vercel
1. Suba esta pasta para um repositório no GitHub e importe o repositório em https://vercel.com.
2. Em **Environment Variables**, cadastre as variáveis de `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ANTHROPIC_API_KEY`, `SETUP_TOKEN` (invente uma senha longa) e, se quiser, `ANTHROPIC_MODEL`.
3. Deploy.

### 4. Primeiro acesso
1. Abra `https://SEU-SITE/setup`, informe o `SETUP_TOKEN` e crie o administrador. A tela se desativa depois disso.
2. Entre em `/login`, crie o campeonato, cadastre os 16 times (aba **Times e capitães**) com usuário e senha de cada capitão.
3. Em **Partidas e regras**, marque o campeonato como **Em andamento** e **Mostrar ao público**.
4. No domingo: ao fim de cada partida, mude a partida para **Aberta** (com prazo, se quiser). Acompanhe pela **Central de validação**.
5. No domingo seguinte: abra o campeonato anterior e use **Duplicar campeonato**.

Modo transmissão (OBS, Browser Source 1920x1080): `https://SEU-SITE/transmissao`.
Para fundo transparente: `/transmissao?fundo=transparente`.

## Rodar no computador

```bash
cp .env.example .env.local   # preencha as chaves
npm install
npm run dev                  # http://localhost:3000
npm test                     # regras de pontuação, leitura, desempate e permissões do banco
```

## Regras implementadas

| Regra | Onde |
|---|---|
| Só a coluna BAIXAS pontua; ELIMINAÇÕES é ignorada | prompt em `src/lib/vision.ts`; o banco não tem coluna "kills", só `scoring_baixas` |
| Pontos = baixas × multiplicador + bônus, por partida, em `numeric` | função SQL `calc_points` |
| Soma dos 3 jogadores comparada ao total do esquadrão | `src/lib/evaluate.ts` |
| A IA nunca completa valor ilegível: fica vazio e vai para análise | `vision.ts` + `evaluate.ts` |
| Nome com clan tag, acento, espaço ou caixa diferente | `src/lib/names.ts` (abaixo de 85% de semelhança não aprova sozinho) |
| Uma colocação por time e um vencedor por partida | alerta na confirmação + restrição `unique (match_id, placement)` no banco |
| Print duplicada (hash do arquivo + hash perceptual) | `src/lib/imagehash.ts`; gera alerta, nunca rejeita sozinho |
| Capitão não edita números; report validado só reabre pelo admin | `src/app/capitao/actions.ts` + RLS sem permissão de escrita |
| Toda alteração do admin com usuário, data, valor anterior, novo e motivo | tabela `audit_logs` |

### Fluxo de status
`Aguardando report` → o capitão envia as prints → a IA lê → o capitão confirma ou informa divergência →
- sem nenhum alerta: **Validada** (ou **Enviada**, se a validação automática estiver desligada no campeonato);
- leitura insegura, nome duvidoso, print faltando ou possível duplicada: **Em análise**;
- soma diferente do total, colocação repetida ou discordância do capitão: **Divergência**.

O administrador pode corrigir, validar, rejeitar ou reabrir qualquer report.

## Limites conhecidos
- O aviso "faltam 10 minutos" aparece na tela do capitão como contagem regressiva; não é enviado como notificação separada.
- Renomear um time ou jogador altera o nome também nos campeonatos antigos. Para trocar um jogador sem mexer no histórico, marque **É outro jogador** ao editar o time.
- O limite de semelhança para print duplicada (`PHASH_MAX_DISTANCE`) pode precisar de ajuste depois dos primeiros domingos.
