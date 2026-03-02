export function generateKartela(total: number, cells = 100, maxCell = 300) {
  if (total <= 0) throw new Error("Total inválido.");
  if (cells <= 0) throw new Error("Quantidade de células inválida.");
  if (total > cells * maxCell) {
    throw new Error(`Meta muito alta. Com ${cells} células, o máximo é R$ ${cells * maxCell}.`);
  }

  // 1) base: muitos pequenos (1..50), com distribuição enviesada pro baixo
  const values: number[] = [];
  let remaining = total;

  for (let i = 0; i < cells; i++) {
    const remainingCells = cells - i;

    // garante que sobra "espaço" pros próximos sem estourar maxCell
    const maxAllowedNow = Math.min(maxCell, remaining - (remainingCells - 1) * 1);
    const minAllowedNow = Math.max(1, remaining - (remainingCells - 1) * maxCell);

    // peso pro pequeno: quadrático (mais chance de 1..20 do que 40..50)
    let candidate = Math.floor(1 + 50 * Math.random() ** 2);

    // em fases finais, permite crescer um pouco (ainda <= maxCell)
    const growth = 1 + (i / cells) * 0.8;
    candidate = Math.round(candidate * growth);

    // clamp pelos limites reais
    candidate = Math.max(minAllowedNow, Math.min(candidate, maxAllowedNow));

    values.push(candidate);
    remaining -= candidate;
  }

  // ajuste fino (deve ficar 0, mas por segurança)
  if (remaining !== 0) values[values.length - 1] += remaining;

  // embaralha para não ficar crescente
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }

  return values;
}