-- ===================== EXAMPLE DATA (optional) =====================
insert into categories (id, label, required, optional) values
  ('shoes',   'Shoes',   '{type,size,colour}', '{brand,model,condition}'),
  ('bike',    'Bike',    '{type,frame_size}',  '{brand,condition}'),
  ('helmet',  'Helmet',  '{size}',             '{brand,colour}'),
  ('jacket',  'Jacket',  '{size}',             '{colour,brand}'),
  ('glasses', 'Glasses', '{}',                 '{brand}')
on conflict (id) do nothing;

insert into bundles (id, label, description, category_ids) values
  ('cycling', 'Cycling starter kit',
   'For someone who wants to start cycling / get into cycling / needs a cycling kit: bike, helmet, jacket and glasses.',
   '{bike,helmet,jacket,glasses}')
on conflict (id) do nothing;

insert into accounts (id, name, type, persona) values
  ('tom',          'Tom',          'private', 'Private seller who wants a quick sale. Friendly and casual, concedes in big steps, happy to close fast once the offer is reasonable.'),
  ('nike-store',   'Nike Store',   'brand',   'Official Nike store. Firm on price: small concessions only, stresses authenticity, warranty and free returns.'),
  ('adidas-store', 'Adidas Store', 'brand',   'Official Adidas store. Polite, modest discounts, mentions new-season stock.'),
  ('anna',         'Anna',         'private', 'Casual private seller clearing out her wardrobe and garage. Flexible and chatty, likes to meet people halfway.'),
  ('cycle-hub',    'Cycle Hub',    'brand',   'Local bike shop. Fair but firm: small discounts, mentions the free first service and fitting.')
on conflict (id) do nothing;

insert into listings (id, seller_id, category, title, attributes, asking_price, floor_price) values
  -- shoes that match {sport, black, 8}
  ('l-tom-am90-8',          'tom',          'shoes', 'Used Nike Air Max 90, black, UK 8',
     '{"type":"sport","size":"8","colour":"black","brand":"nike","model":"air max 90","condition":"used"}',         90,  70),
  ('l-nike-am90-8',         'nike-store',   'shoes', 'New Nike Air Max 90, black, UK 8',
     '{"type":"sport","size":"8","colour":"black","brand":"nike","model":"air max 90","condition":"new"}',         120, 105),
  ('l-anna-ultraboost-8',   'anna',         'shoes', 'Adidas Ultraboost, black, UK 8',
     '{"type":"sport","size":"8","colour":"black","brand":"adidas","model":"ultraboost","condition":"used"}',      85,  68),
  -- shoes: near misses
  ('l-anna-gazelle-8',      'anna',         'shoes', 'Adidas Gazelle, white, UK 8',
     '{"type":"casual","size":"8","colour":"white","brand":"adidas","model":"gazelle","condition":"used"}',        55,  45),
  ('l-tom-am90-10',         'tom',          'shoes', 'Used Nike Air Max 90, black, UK 10',
     '{"type":"sport","size":"10","colour":"black","brand":"nike","model":"air max 90","condition":"used"}',       80,  60),
  ('l-tom-revolution-8',    'tom',          'shoes', 'Used Nike Revolution 6, blue, UK 8',
     '{"type":"sport","size":"8","colour":"blue","brand":"nike","model":"revolution 6","condition":"used"}',       30,  20),
  ('l-nike-am270-8',        'nike-store',   'shoes', 'New Nike Air Max 270, white, UK 8',
     '{"type":"sport","size":"8","colour":"white","brand":"nike","model":"air max 270","condition":"new"}',        140, 125),
  ('l-nike-pegasus-9',      'nike-store',   'shoes', 'New Nike Pegasus 41, black, UK 9',
     '{"type":"sport","size":"9","colour":"black","brand":"nike","model":"pegasus 41","condition":"new"}',         125, 110),
  ('l-nike-af1-8',          'nike-store',   'shoes', 'New Nike Air Force 1, black, UK 8',
     '{"type":"casual","size":"8","colour":"black","brand":"nike","model":"air force 1","condition":"new"}',       110, 95),
  ('l-adidas-ultraboost-9', 'adidas-store', 'shoes', 'New Adidas Ultraboost Light, black, UK 9',
     '{"type":"sport","size":"9","colour":"black","brand":"adidas","model":"ultraboost light","condition":"new"}', 150, 130),
  ('l-adidas-samba-8',      'adidas-store', 'shoes', 'New Adidas Samba, white, UK 8',
     '{"type":"casual","size":"8","colour":"white","brand":"adidas","model":"samba","condition":"new"}',          90,  80),
  ('l-adidas-runfalcon-8',  'adidas-store', 'shoes', 'New Adidas Runfalcon 5, grey, UK 8',
     '{"type":"sport","size":"8","colour":"grey","brand":"adidas","model":"runfalcon 5","condition":"new"}',       55,  48),
  -- bikes
  ('l-hub-boardman-l',      'cycle-hub', 'bike', 'New Boardman HYB 8.6 hybrid bike, L frame',
     '{"type":"hybrid","frame_size":"l","brand":"boardman","condition":"new"}',     650, 560),
  ('l-hub-boardman-m',      'cycle-hub', 'bike', 'New Boardman HYB 8.6 hybrid bike, M frame',
     '{"type":"hybrid","frame_size":"m","brand":"boardman","condition":"new"}',     650, 560),
  ('l-hub-allez-l',         'cycle-hub', 'bike', 'New Specialized Allez road bike, L frame',
     '{"type":"road","frame_size":"l","brand":"specialized","condition":"new"}',    900, 780),
  ('l-anna-carrera-l',      'anna',      'bike', 'Used Carrera Subway hybrid bike, L frame',
     '{"type":"hybrid","frame_size":"l","brand":"carrera","condition":"used"}',     280, 220),
  ('l-anna-trek-m',         'anna',      'bike', 'Used Trek Domane AL 2 road bike, M frame',
     '{"type":"road","frame_size":"m","brand":"trek","condition":"used"}',          450, 380),
  -- helmets
  ('l-hub-giro-m',          'cycle-hub', 'helmet', 'New Giro Register MIPS helmet, M, black',
     '{"size":"m","colour":"black","brand":"giro","condition":"new"}',              55,  45),
  ('l-hub-giro-l',          'cycle-hub', 'helmet', 'New Giro Register MIPS helmet, L, black',
     '{"size":"l","colour":"black","brand":"giro","condition":"new"}',              55,  45),
  ('l-anna-align-l',        'anna',      'helmet', 'Used Specialized Align helmet, L, white',
     '{"size":"l","colour":"white","brand":"specialized","condition":"used"}',      25,  18),
  -- jackets
  ('l-hub-dhb-l',           'cycle-hub', 'jacket', 'New dhb hi-vis waterproof cycling jacket, L, yellow',
     '{"size":"l","colour":"yellow","brand":"dhb","condition":"new"}',              70,  55),
  ('l-hub-dhb-m',           'cycle-hub', 'jacket', 'New dhb waterproof cycling jacket, M, black',
     '{"size":"m","colour":"black","brand":"dhb","condition":"new"}',               70,  55),
  ('l-anna-altura-l',       'anna',      'jacket', 'Used Altura Nightvision jacket, L, yellow',
     '{"size":"l","colour":"yellow","brand":"altura","condition":"used"}',          35,  25),
  -- glasses
  ('l-hub-oakley',          'cycle-hub', 'glasses', 'New Oakley Sutro Lite cycling glasses',
     '{"brand":"oakley","condition":"new"}',                                        120, 100),
  ('l-hub-tifosi',          'cycle-hub', 'glasses', 'New Tifosi Swank glasses, clear/tinted lenses',
     '{"brand":"tifosi","condition":"new"}',                                        30,  24),
  ('l-anna-rockrider',      'anna',      'glasses', 'Used Rockrider cycling glasses',
     '{"brand":"rockrider","condition":"used"}',                                    12,  8)
on conflict (id) do nothing;
