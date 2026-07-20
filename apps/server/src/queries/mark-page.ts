export const markTypeSql = `case
  when m.mark_drawing_code = '1' then 'typeset'
  when m.mark_drawing_code = '4' then 'text'
  when m.mark_drawing_code in ('2', '3', '5') then 'design'
  else 'other'
end`;

interface MarkFilters {
  registered: "all" | "yes" | "no";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text" | "other";
}

export function markFilterConditions(input: MarkFilters, parameter: (value: string) => string) {
  const conditions: string[] = [];
  if (input.status !== "all") {
    conditions.push(`m.search_status = ${parameter(input.status)}`);
  }
  if (input.type !== "all") {
    conditions.push(`${markTypeSql} = ${parameter(input.type)}`);
  }
  if (input.registered === "yes") {
    conditions.push("m.registration_number is not null");
  } else if (input.registered === "no") {
    conditions.push("m.registration_number is null");
  }
  return conditions;
}

export const markSummarySql = `
  m.serial_number as "serialNumber",
  m.registration_number as "registrationNumber",
  m.word_mark as "wordMark",
  m.search_status as status,
  m.status_date::text as "statusDate",
  m.source_transaction_date::text as "sourceTransactionDate",
  ${markTypeSql} as type,
  array(
    select distinct classification.international_code
    from mark_class classification
    where classification.serial_number = m.serial_number
      and classification.international_code is not null
    order by classification.international_code
  ) as "internationalClasses",
  (select owner.party_name from mark_owner owner
    where owner.serial_number = m.serial_number order by owner.ordinal limit 1) as owner,
  (select goods.text from mark_goods_services goods
    where goods.serial_number = m.serial_number
    order by case
      when goods.type_code like 'GS025%' then 0
      when goods.type_code like 'GS%' then 1
      when goods.type_code like 'CC%' then 3
      else 2
    end, goods.ordinal
    limit 1) as "goodsServicesExcerpt"`;
