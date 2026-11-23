# Sistema de Gestão Pilotis

Sistema web de gestão financeira, comercial, planejamento de obras, equipe, POPs e conformidade para construtora residencial de alto padrão.

## Stack

- **Frontend:** React, TypeScript, Tailwind CSS (Vite)
- **Domínio puro e testes:** `/src/domain` com `node --test` (`npm test`)
- **Backend / Persistência:** Firebase Authentication (e-mail e senha) e Cloud Firestore com persistência offline e regras estritas de segurança

## Configuração do e-mail único da empresa (obrigatório)

O acesso ao sistema é exclusivo de **um único usuário em nome da empresa**, com e-mail verificado no Firebase Authentication.

Por segurança, o e-mail autorizado precisa estar **idêntico** em dois pontos:

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


## Documentação e protótipos de referência

Os documentos de escopo, telas de referência e guia visual estão armazenados em `/docs`, fora de `/public`, para não serem publicados no bundle final de produção (`/dist`).

## Comandos

```bash
npm install        # Instala dependências
npm run dev        # Servidor de desenvolvimento na porta 3000
npm test           # Executa testes unitários da camada de domínio (/src/domain)
npm run lint       # Checagem TypeScript
npm run build      # Gera build de produção em /dist e compila server.ts -> server.js
npm start          # Inicia o servidor compilado (node server.js)
```
