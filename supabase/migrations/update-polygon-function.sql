-- Update function to use ST_Intersects instead of ST_Within
create or replace function core.pois_in_polygon(wkt_polygon text)
returns table(attraction_id uuid) as $$
begin
  return query
    select ac.attraction_id
    from core.attraction_coordinate ac
    where ST_Intersects(
      ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326),
      ST_GeomFromText(wkt_polygon, 4326)
    );
end;
$$ language plpgsql stable; 