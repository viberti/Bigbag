# frontend/ — PWA (React/Vite)

Placeholder. A PWA é montada quando chegarmos à camada de cliente (gravar fatura por câmara e nota de voz por microfone).

- Stack prevista: React + Vite, com manifest PWA e service worker.
- APIs do browser críticas: `getUserMedia` + `MediaRecorder` (câmara e microfone). **Testar em dispositivo real**, sobretudo iOS/Safari (ver Conceito §2).
- Build (`npm run build`) gera `dist/`, servido pelo Apache em produção; o backend (porta 4200) fica atrás do proxy.

Ainda nada de código aqui — é só a reserva da pasta na estrutura do repositório.
