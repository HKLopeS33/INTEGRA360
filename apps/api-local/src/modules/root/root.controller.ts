import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class RootController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  show() {
    return `
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Sistema Shawarma API Local</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #eef2ef;
              color: #18201d;
              font-family: Arial, sans-serif;
            }
            main {
              width: min(720px, calc(100vw - 32px));
              background: #ffffff;
              border: 1px solid #dbe3de;
              border-radius: 8px;
              padding: 28px;
            }
            h1 {
              margin: 0 0 8px;
              font-size: 28px;
            }
            p {
              color: #52625b;
              line-height: 1.5;
            }
            a {
              display: inline-flex;
              margin-top: 12px;
              background: #f1c44e;
              color: #18201d;
              border-radius: 8px;
              padding: 12px 14px;
              text-decoration: none;
              font-weight: 700;
            }
            code {
              background: #eef2ef;
              border-radius: 6px;
              padding: 3px 6px;
            }
            ul {
              color: #52625b;
              line-height: 1.8;
            }
          </style>
        </head>
        <body>
          <main>
            <h1>Sistema Shawarma API Local</h1>
            <p>A API esta online em <code>localhost:3333</code>. A tela visual do sistema roda no frontend local.</p>
            <a href="http://127.0.0.1:5173">Abrir painel do sistema</a>
            <p>Endpoints principais:</p>
            <ul>
              <li><code>/health</code></li>
              <li><code>/tables</code></li>
              <li><code>/menu/products</code></li>
              <li><code>/orders</code></li>
              <li><code>/kitchen/queue</code></li>
              <li><code>/cash-register/current</code></li>
            </ul>
          </main>
        </body>
      </html>
    `;
  }
}
