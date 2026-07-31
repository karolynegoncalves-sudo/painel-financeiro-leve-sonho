/**
 * Motor de cálculo da precificação — funções puras (sem DOM, sem fetch),
 * mesma fórmula confirmada nas 5 planilhas FPV reais da Leve Sonho.
 * Formato de dados:
 *   materiais: [{descricao, valorUnitario, qtdUtilizada, valorManual}]
 *     (se valorManual tiver número, usa ele direto; senão valorUnitario × qtdUtilizada)
 *   maoDeObra: [{descricao, salarioMensal, horasMes, tempoExecucaoMinutos}]
 *   outros:    [{descricao, valor}]
 *   tarifas:   {impostosPct, comissaoPct, extra1Nome, extra1Pct, extra2Nome, extra2Pct}
 */
window.PrecifCalc = (function () {
  const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

  function custoMateriaPrima_(materiais) {
    return (materiais || []).reduce((soma, m) => {
      const manual = num(m.valorManual);
      if (manual > 0) return soma + manual;
      return soma + num(m.valorUnitario) * num(m.qtdUtilizada);
    }, 0);
  }

  function custoMaoDeObra_(maoDeObra) {
    return (maoDeObra || []).reduce((soma, f) => {
      const horas = num(f.horasMes);
      if (!horas) return soma;
      const valorHora = num(f.salarioMensal) / horas;
      return soma + valorHora * (num(f.tempoExecucaoMinutos) / 60);
    }, 0);
  }

  function custoOutros_(outros) {
    return (outros || []).reduce((soma, o) => soma + num(o.valor), 0);
  }

  function custoProduto_(materiais, maoDeObra, outros) {
    return custoMateriaPrima_(materiais) + custoMaoDeObra_(maoDeObra) + custoOutros_(outros);
  }

  function custoVariavelPct_(tarifas) {
    if (!tarifas) return 0;
    return num(tarifas.impostosPct) + num(tarifas.comissaoPct) + num(tarifas.extra1Pct) + num(tarifas.extra2Pct);
  }

  /** Dado um preço de venda já escolhido, devolve o detalhamento completo. */
  function breakdown_(precoVenda, custoProduto, custoVariavelPct, despesasFixasPct) {
    const preco = num(precoVenda);
    const custo = num(custoProduto);
    const despesasFixasReais = preco * num(despesasFixasPct);
    const custoVariavelReais = preco * num(custoVariavelPct);
    const lucroReais = preco - custo - despesasFixasReais - custoVariavelReais;
    const margemContribReais = preco - custo - custoVariavelReais;
    return {
      custoProduto: custo,
      custoProdutoPct: preco ? custo / preco : 0,
      despesasFixasReais, despesasFixasPct: num(despesasFixasPct),
      custoVariavelReais, custoVariavelPct: num(custoVariavelPct),
      lucroReais, lucroPct: preco ? lucroReais / preco : 0,
      markup: custo ? preco / custo : 0,
      margemContribReais, margemContribPct: preco ? margemContribReais / preco : 0
    };
  }

  /** Preço necessário pra bater uma margem de lucro alvo, dado o custo e as taxas. */
  function precoSugerido_(custoProduto, despesasFixasPct, custoVariavelPct, margemAlvoPct) {
    const divisor = 1 - num(despesasFixasPct) - num(custoVariavelPct) - num(margemAlvoPct);
    if (divisor <= 0) return null; // taxas + margem alvo somam 100%+, não dá pra atingir
    return num(custoProduto) / divisor;
  }

  function ladderSugerido_(custoProduto, despesasFixasPct, custoVariavelPct) {
    return [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30].map(margemAlvoPct => ({
      margemAlvoPct,
      precoSugerido: precoSugerido_(custoProduto, despesasFixasPct, custoVariavelPct, margemAlvoPct)
    }));
  }

  return {
    custoMateriaPrima_, custoMaoDeObra_, custoOutros_, custoProduto_,
    custoVariavelPct_, breakdown_, precoSugerido_, ladderSugerido_
  };
})();
