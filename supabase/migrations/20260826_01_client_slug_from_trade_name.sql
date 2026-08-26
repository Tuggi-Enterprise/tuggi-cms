-- O slug público do parceiro nasce do NOME FANTASIA, não da razão social.
--
-- O QUE FOI MEDIDO, em 2026-08-26. O parceiro `Cozi +` respondeu ao formulário com
-- `trade_name = 'Cozi +'` e `legal_name = 'Cozimais Restaurante e Café'`, e
-- `lib/partner-form/promotion.ts` escreve os dois nas colunas certas — `name` recebe o fantasia,
-- `company_name` recebe a razão social (é dela que `lib/contract/snapshot.ts` tira o `legalName`
-- do contrato). `partner.ensure_client_slug` então montava o slug com
-- `COALESCE(NULLIF(company_name,''), name)`, ou seja, a razão social primeiro, e a URL pública
-- saiu `/d/cozimais-restaurante-e-cafe`.
--
-- `/d/{slug}` é o endereço que o turista digita, lê no material impresso e aponta a câmera para
-- ler no QR code. O que está na fachada é o fantasia. Decisão do operador em 2026-08-26: a
-- ordem do COALESCE inverte.
--
-- ISTO NÃO TOCA EM NENHUM SLUG QUE JÁ EXISTE, e a garantia é da própria função: o ramo `UPDATE`
-- nunca regenera — slug em branco num UPDATE volta a ser `OLD.slug`, e só um valor digitado pelo
-- operador substitui o que está lá. A geração acontece em `INSERT`, e só quando `slug` vem
-- vazio. Um slug já distribuído em QR code não pode mudar por causa de uma migration.
--
-- ROLLBACK: reaplicar a função com `COALESCE(NULLIF(NEW.company_name, ''), NEW.name)` nos dois
-- pontos abaixo. Nenhum dado é reescrito nesta migration, então voltar atrás é só a definição.

CREATE OR REPLACE FUNCTION partner.ensure_client_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      -- The trade name first: it is what the tourist reads on the sign and on the printed
      -- material, and `/d/{slug}` is a public address, not a legal one.
      NEW.slug := partner.next_unique_client_slug(COALESCE(NULLIF(NEW.name, ''), NEW.company_name), NULL);
    ELSE
      NEW.slug := core.slugify(NEW.slug);
      IF NEW.slug = '' THEN
        NEW.slug := partner.next_unique_client_slug(COALESCE(NULLIF(NEW.name, ''), NEW.company_name), NULL);
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Untouched on purpose: a slug already in circulation is never regenerated.
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := OLD.slug;
    ELSE
      NEW.slug := core.slugify(NEW.slug);
      IF NEW.slug = '' THEN
        NEW.slug := OLD.slug;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION partner.ensure_client_slug() IS
  'Fills partner.clients.slug on INSERT from the trade name (name), falling back to the legal '
  'name (company_name). Never regenerates an existing slug: /d/{slug} is printed on partner '
  'material and a QR code cannot change under it.';
