/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    utilizator: import('./lib/auth').Utilizator | null
  }
}
