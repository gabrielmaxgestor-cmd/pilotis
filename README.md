# Sistema de Gestão Pilotis

Sistema web de gestão financeira, comercial, planejamento de obras, equipe, POPs e conformidade para construtora residencial de alto padrão.

## Stack

- **Frontend:** React, TypeScript, Tailwind CSS (Vite)
- **Domínio puro e testes:** `/src/domain` com `node --test` (`npm test`)
- **Backend / Persistência:** Firebase Authentication (e-mail e senha) e Cloud Firestore com persistência offline e regras estritas de segurança

## Configuração do e-mail único da empresa (obrigatório)

O acesso ao sistema é exclusivo de **um único usuário em nome da empresa**, com e-mail verificado no Firebase Authentication.

Por segurança, o e-mail autorizado precisa estar **idêntico** nos três pontos:

1. **Frontend (`src/config/companyAuth.ts` / variável `VITE_COMPANY_EMAIL`):**
   - Arquivo: `src/config/companyAuth.ts` (`COMPANY_EMAIL`, que lê `import.meta.env.VITE_COMPANY_EMAIL` com fallback `'empresa@pilotis.com.br'`).
2. **Backend (`server.ts` / variável `COMPANY_EMAIL` ou `VITE_COMPANY_EMAIL`):**
   - O endpoint `POST /api/ai/chat` valida o ID token Firebase via Firebase Admin SDK e compara `email` + `email_verified: true` com `COMPANY_EMAIL` / `VITE_COMPANY_EMAIL` (fallback `'empresa@pilotis.com.br'`).
3. **Regras de Segurança do Firestore (`firestore.rules`):**
   - Função `companyEmail()` em `firestore.rules` (padrão `'empresa@pilotis.com.br'`).

> **Importante:** Todos esses pontos (`COMPANY_EMAIL` / `VITE_COMPANY_EMAIL` no frontend e no `server.ts`, e `companyEmail()` em `firestore.rules`) **precisam coincidir exatamente** (comparação em minúsculas). Se você alterar o e-mail da empresa em um deles sem atualizar os demais e publicar as regras, o acesso ao app, ao Firestore ou à IA Operacional será bloqueado.

Sempre que alterar `firestore.rules`, valide e publique as regras antes de usar em produção.

## Variáveis de ambiente e segredos

- Nunca versione arquivos `.env` ou chaves reais no repositório (`.env*` está listado no `.gitignore`, exceto `.env.example`).
- Use `.env.example` como referência dos nomes de variáveis aceitos (`GEMINI_API_KEY`, `GEMINI_MODEL`, `VITE_COMPANY_EMAIL`, `COMPANY_EMAIL`).
- O modelo do Gemini usado pelo endpoint `/api/ai/chat` é lido de `GEMINI_MODEL` (padrão `gemini-4-hydrogen`).


## IA Operacional

O frontend envia a pergunta e o ID token Firebase a um endpoint do Express. O backend consulta o Firestore indicado em
`firebase-applet-config.json`, calcula os indicadores na camada de domínio e usa o Gemini para selecionar as referências
pertinentes. A resposta é montada com os valores e as fontes dessas referências. As conversas são gravadas em
`conversasIA/{uid}/mensagens`. O resumo semanal é gerado sob demanda na IA Operacional.

No AI Studio, configure `GEMINI_API_KEY` no painel **Secrets** e publique o aplicativo completo com seu servidor Node.
No Cloud Run, a identidade do serviço precisa de acesso de leitura e gravação ao mesmo banco Firestore do aplicativo.
O backend usa as credenciais padrão dessa identidade. Localmente, use ADC com acesso ao projeto de teste
(por exemplo, depois de autenticar via `gcloud auth application-default login`).
`GEMINI_MODEL` permite substituir o modelo padrão pelo ID compatível habilitado no projeto.

## Documentação e protótipos de referência

Os documentos de escopo, telas de referência e guia visual estão armazenados em `/docs`, fora de `/public`, para não serem publicados no bundle final de produção (`/dist`).


## Diário de obra, modo offline e fotos

Abra a versão de produção uma vez online e entre com a conta da empresa para carregar as obras, etapas e POPs no aparelho. Em HTTPS (ou localhost), o menu do navegador permite instalar o Pilotis. O service worker armazena a interface e a fila em IndexedDB guarda registros e fotos comprimidas até receber confirmação do Firebase. A sincronização ocorre ao reconectar com o app aberto ou ao reabri-lo.

O modo padrão, `VITE_DAILY_LOG_PHOTO_BACKEND=firestore`, grava cada JPEG em `dailyLogs/{logId}/photos/{photoId}`. Publique as regras de `firestore.rules` no banco configurado em `firebase-applet-config.json`. Cada registro aceita até seis fotos de até 384 KiB após compressão.

Para usar Firebase Storage, provisione o bucket no projeto, publique `storage.rules` com o mesmo e-mail da conta da empresa e configure o CORS para permitir `GET` na origem do app. Defina `VITE_DAILY_LOG_PHOTO_BACKEND=storage` e gere um novo build. Os registros anteriores continuam sendo lidos do backend gravado em cada registro.

## Comandos

```bash
npm install        # Instala dependências
npm run dev        # Servidor de desenvolvimento na porta 3000
npm test           # Executa testes unitários da camada de domínio (/src/domain)
npm run lint       # Checagem TypeScript
npm run build      # Gera build de produção em /dist e compila server.ts -> server.js
npm start          # Inicia o servidor compilado (node server.js)
```
