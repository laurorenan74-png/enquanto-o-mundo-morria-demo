# AGENTS.md — Contrato Arquitetural (Enquanto o Mundo Morria — Demo)

## 1. Visão Geral e Stack Obrigatória
- **Gênero / Referência:** Point-and-Click de horror psicológico (referência: *The Excavation of Hob's Barrow*).
- **Stack:** TypeScript + Vite + Phaser 3.
- **Resolução Lógica:** `320x180` px fixos, `pixelArt: true`, escalonamento inteiro (`Phaser.Scale.FIT` + `image-rendering: pixelated`).
- **Arquitetura 100% Data-Driven:** Nenhuma fala, flag, item, sala ou regra de transição pode ser *hardcoded* no código-fonte. Todo o conteúdo reside em `/public/game_data/`:
  - `sprint1_story_graph.json` (estado inicial, itens, evidências, atos, DAG `N01`–`N14`)
  - `sprint2_rooms_spec.json` (6 salas, polígonos caminháveis, escala de profundidade, hotspots, iluminação)
  - `sprint3_dialogues.json` (55 nós `DLG_*` / `EVT_*`)
  - `sprint3_journal.json` (cabeçalhos de palavras-chave + 5 evidências `K1`–`K5`)
  - `entities.json` (nomes de exibição, especificações visuais para retratos/greybox e perfis de voz)

## 2. Regras de Renderização e Estratégia Greybox-First
- **Fase 1 (Greybox Jogável):** Renderize cada sala usando `palette_hex` para o fundo, `walkable_polygon` como piso delimitado, e `bounds` (`[x, y, w, h]`) de cada hotspot como retângulos rotulados.
- **Fase 2 (Substituição de Arte):** Se existir `/public/assets/rooms/{room_id}.png`, carregue-o automaticamente no lugar do greybox sem alterar lógica ou polígonos.
- **Escala de Profundidade:** Aplique estritamente:
  `scale(y) = scale_min + ((clamp(y, y_min, y_max) - y_min) / (y_max - y_min)) * (scale_max - scale_min)`
- **Câmera:** `R06_PATIO` tem largura `480px` (`scrolling: true`); habilite `camera.startFollow(player)` limitado a `[0, 0, 480, 180]`. Demais salas são estáticas (`320x180`).
- **Zonas Seguras de UI:**
  - Barra superior (`y: 0..16`): Inventário retrátil, botão Diário (`J`), e Relógio Narrativo (`τ` em minutos, visível apenas no Ato II).
  - Faixa inferior (`y: 152..180`): Legendas (máx. 140 chars/linha) e opções de diálogo ramificado.
  - **Retratos e Nomes:** Ao exibir falas, resolva `speaker` em `entities.json` para renderizar `name` e o placeholder/retrato correspondente (`/public/assets/portraits/{entity_id}.png` na Fase 2).

## 3. Controles e Verbos (Padrão Hob's Barrow)
- **Clique Esquerdo:** Caminhar até `walk_to` (dentro do `walkable_polygon`) e executar `interact` (ou transição de `exit`). Se um item do inventário estiver selecionado, executar `use_item[itemId]` ou fallback `wrong_item`.
- **Clique Direito:** Executar `examine` (desative o menu de contexto nativo do navegador).
- **Tecla `Tab` ou `Espaço`:** Destacar visualmente todos os hotspots com `visible_if == true`.

## 4. Motor de Estado e Avaliador de Expressões
- Estado global: `GameState = { active_room, inventory, flags, evidences, narrative_clock }`.
- Avaliador determinístico para `visible_if`, `requires` e `condition` suportando:
  - `true`, `false`, `&&`, `==`, `!=`
  - `has_item('ITEM_ID')`, `!has_item('ITEM_ID')`
  - Referências diretas a chaves de `flags` (ex.: `FLAG_KIT_PRONTO == true`).
- Ao entrar em `R03_CABANA` pela primeira vez, disparar `DLG_R03_INTRO_AUDIO` em tela preta antes de exibir a sala.
- Ao concluir `EVT_R05_PORTA_TRANCADA_FINAL`, disparar `ENDING_CLIFFHANGER` com o stinger canônico do Capítulo 4.

## 5. Critério de Aceite (Definition of Done)
1. `npm run build` sem erros de TypeScript (`strict: true`).
2. `npx tsx tests/walkthrough_test.ts` passando 100% (`N01` -> `N14`, `FLAG_DEMO_FIM === true`, `evidences.length === 5`).
3. Zero erros de console ao jogar do início ao fim no navegador.
