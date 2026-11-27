// _shared/store-country.ts
//
// The country of a store report, as `social.store_country_daily.country` keeps it (#1169, interface fixed on
// #1306): ISO 3166-1 alpha-2 in upper case, the CHECK `^[A-Z]{2}$`. The one place a vendor's label becomes that
// code; the Apple and the Play collectors both call `countryCode`.
//
// Checked 2026-11-27. Apple's Analytics Reports documentation (app-store-discovery-and-engagement, app-download)
// describes `Territory` as "The App Store country or region in which the event occurred", a string, without
// saying which code; App Store Connect names territories in alpha-3 elsewhere (the `territories` resource ids,
// `USA`), so both are taken. The Play Console help (answer 6135870) lists a `Country` column, also without the
// code. Anything that is neither two letters nor a known alpha-3 is not a country here: the collector drops the
// row and lists the label in its `collector_runs.detail`, so the first real run shows what came.
//
// Import-free.

/**
 * Every ISO 3166-1 entry (Debian iso-codes, `iso_3166-1.json`, 249 codes) plus XKS for Kosovo, which the App
 * Store sells in: five letters each, the alpha-3 then its alpha-2.
 */
const ALPHA3_TO_ALPHA2 =
  'ABWAW AFGAF AGOAO AIAAI ALAAX ALBAL ANDAD AREAE ARGAR ARMAM ASMAS ATAAQ ATFTF ATGAG AUSAU AUTAT AZEAZ ' +
  'BDIBI BELBE BENBJ BESBQ BFABF BGDBD BGRBG BHRBH BHSBS BIHBA BLMBL BLRBY BLZBZ BMUBM BOLBO BRABR BRBBB ' +
  'BRNBN BTNBT BVTBV BWABW CAFCF CANCA CCKCC CHECH CHLCL CHNCN CIVCI CMRCM CODCD COGCG COKCK COLCO COMKM ' +
  'CPVCV CRICR CUBCU CUWCW CXRCX CYMKY CYPCY CZECZ DEUDE DJIDJ DMADM DNKDK DOMDO DZADZ ECUEC EGYEG ERIER ' +
  'ESHEH ESPES ESTEE ETHET FINFI FJIFJ FLKFK FRAFR FROFO FSMFM GABGA GBRGB GEOGE GGYGG GHAGH GIBGI GINGN ' +
  'GLPGP GMBGM GNBGW GNQGQ GRCGR GRDGD GRLGL GTMGT GUFGF GUMGU GUYGY HKGHK HMDHM HNDHN HRVHR HTIHT HUNHU ' +
  'IDNID IMNIM INDIN IOTIO IRLIE IRNIR IRQIQ ISLIS ISRIL ITAIT JAMJM JEYJE JORJO JPNJP KAZKZ KENKE KGZKG ' +
  'KHMKH KIRKI KNAKN KORKR KWTKW LAOLA LBNLB LBRLR LBYLY LCALC LIELI LKALK LSOLS LTULT LUXLU LVALV MACMO ' +
  'MAFMF MARMA MCOMC MDAMD MDGMG MDVMV MEXMX MHLMH MKDMK MLIML MLTMT MMRMM MNEME MNGMN MNPMP MOZMZ MRTMR ' +
  'MSRMS MTQMQ MUSMU MWIMW MYSMY MYTYT NAMNA NCLNC NERNE NFKNF NGANG NICNI NIUNU NLDNL NORNO NPLNP NRUNR ' +
  'NZLNZ OMNOM PAKPK PANPA PCNPN PERPE PHLPH PLWPW PNGPG POLPL PRIPR PRKKP PRTPT PRYPY PSEPS PYFPF QATQA ' +
  'REURE ROURO RUSRU RWARW SAUSA SDNSD SENSN SGPSG SGSGS SHNSH SJMSJ SLBSB SLESL SLVSV SMRSM SOMSO SPMPM ' +
  'SRBRS SSDSS STPST SURSR SVKSK SVNSI SWESE SWZSZ SXMSX SYCSC SYRSY TCATC TCDTD TGOTG THATH TJKTJ TKLTK ' +
  'TKMTM TLSTL TONTO TTOTT TUNTN TURTR TUVTV TWNTW TZATZ UGAUG UKRUA UMIUM URYUY USAUS UZBUZ VATVA VCTVC ' +
  'VENVE VGBVG VIRVI VNMVN VUTVU WLFWF WSMWS XKSXK YEMYE ZAFZA ZMBZM ZWEZW';

const ALPHA3 = new Map(ALPHA3_TO_ALPHA2.trim().split(' ').map((t) => [t.slice(0, 3), t.slice(3)]));

/** The alpha-2 code of a vendor's country label, or null when it is not one. */
export function countryCode(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(v)) return v;
  return ALPHA3.get(v) ?? null;
}
