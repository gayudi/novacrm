-- Atomic and additive: existing business records, passwords and stock balances are never rewritten.
-- Apply Prisma migrations and create at least one active user before running this PostgreSQL script.
DO $history$
DECLARE
  batch_key constant text := 'retail-history-v1';
  as_of timestamp := COALESCE(NULLIF(current_setting('nova.seed_as_of', true), '')::timestamptz, now()) AT TIME ZONE 'UTC';
  starts_at timestamp := date_trunc('month', as_of) - interval '2 months';
  current_month timestamp := date_trunc('month', as_of);
  first_names text[] := ARRAY['Aditya','Ayu','Bima','Citra','Dimas','Dewi','Eka','Farhan','Fitri','Gilang','Hana','Indra','Intan','Joko','Kartika','Kevin','Laras','Maya','Nadia','Putri','Raka','Rina','Rizky','Sarah','Sinta','Taufik','Vina','Wahyu','Yogi','Zahra'];
  last_names text[] := ARRAY['Wijaya','Saputra','Pratama','Lestari','Santoso','Kusuma','Hidayat','Permata','Wibowo','Gunawan','Setiawan','Utami','Maulana','Nugraha','Rahmawati','Suryadi','Anggraini','Hartono','Purnama','Kurniawan'];
  branches text[] := ARRAY['JAKARTA','BANDUNG','SURABAYA','MEDAN','SEMARANG'];
  sales_ids text[];
  customer_row record;
  opportunity_row record;
  product_row record;
  second_product record;
  day_row record;
  customer_number integer;
  i integer;
  j integer;
  m integer;
  serial integer := 0;
  branch_name text;
  full_name text;
  entity_id text;
  linked_opportunity text;
  status_name text;
  stage_name text;
  activity_type text;
  source_name text;
  created_time timestamp;
  event_time timestamp;
  earliest_time timestamp;
  closed_time timestamp;
  inactive_cutoff timestamp := LEAST(starts_at + interval '20 days', as_of - interval '45 days');
  r double precision;
  progress double precision;
  denominator double precision;
  month_counts integer[];
  pending_count integer;
  quantity integer;
  unit_price numeric(18,2);
  sale_total numeric(18,2);
  batch_counts jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(27062027);
  IF EXISTS (SELECT 1 FROM seed_batches WHERE id = batch_key) THEN
    RAISE NOTICE 'Historical batch % already loaded; no records changed.', batch_key;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE id LIKE 'hist-v1-customer-%') THEN
    RAISE EXCEPTION 'Historical IDs exist without their batch marker. Inspect the database before retrying.';
  END IF;
  SELECT array_agg(id ORDER BY email) INTO sales_ids FROM users WHERE active AND role = 'SALES';
  IF cardinality(sales_ids) IS NULL THEN
    SELECT array_agg(id ORDER BY email) INTO sales_ids FROM users WHERE active AND role IN ('ADMIN', 'MANAGER');
  END IF;
  IF cardinality(sales_ids) IS NULL THEN
    RAISE EXCEPTION 'Historical seed requires an active team member. Run the account bootstrap first.';
  END IF;
  PERFORM setseed(0.271026);

  CREATE TEMP TABLE history_catalogue (
    n integer, name text, sku text, brand text, price numeric, weight numeric, product_id text
  ) ON COMMIT DROP;
  INSERT INTO history_catalogue(n, name, sku, brand, price, weight) VALUES
    (1, 'Apple iPhone 15', 'APL-IP15-128-BLK', 'Apple', 11999000, 9),
    (2, 'Apple iPhone 16', 'APL-IP16-128-ULT', 'Apple', 14999000, 8),
    (3, 'Samsung Galaxy S24', 'SAM-S24-256-GRY', 'Samsung', 11999000, 8),
    (4, 'Samsung Galaxy A55', 'SAM-A55-256-NVY', 'Samsung', 5999000, 15),
    (5, 'Xiaomi 14', 'XMI-14-512-JAD', 'Xiaomi', 9999000, 6),
    (6, 'Xiaomi Redmi Note 13 Pro', 'XMI-RN13P-256-BLK', 'Xiaomi', 3999000, 13),
    (7, 'OPPO Reno12 5G', 'OPP-R12-256-SLV', 'OPPO', 6999000, 9),
    (8, 'Vivo V40', 'VIV-V40-256-PUR', 'Vivo', 6499000, 9),
    (9, 'Realme GT 6', 'RLM-GT6-256-GRN', 'Realme', 7999000, 5),
    (10, 'Infinix GT 20 Pro', 'INF-GT20-256-BLU', 'Infinix', 4299000, 8),
    (11, 'Samsung Galaxy A16', 'SAM-A16-128-BLK', 'Samsung', 2499000, 9),
    (12, 'Infinix Hot 50', 'INF-HOT50-128-GRN', 'Infinix', 2000000, 7),
    (13, 'Apple iPhone 16 Pro Max', 'APL-IP16PM-512-NAT', 'Apple', 25000000, 3),
    (14, 'Samsung Galaxy S24 Ultra', 'SAM-S24U-256-TIT', 'Samsung', 19999000, 4);
  INSERT INTO products(id, name, sku, brand, category, description, price, stock, active, "createdAt", "updatedAt")
  SELECT 'hist-v1-product-' || n, name, sku, brand, 'Smartphone',
    'Official Indonesian warranty. Historical retail price; stock is the reconciled opening balance.',
    price, 65 + n * 9, true, starts_at, starts_at FROM history_catalogue
  ON CONFLICT (sku) DO NOTHING;
  UPDATE history_catalogue c SET product_id = p.id FROM products p WHERE p.sku = c.sku;

  FOR i IN 1..300 LOOP
    r := random();
    branch_name := CASE WHEN r < .34 THEN 'JAKARTA' WHEN r < .56 THEN 'BANDUNG'
      WHEN r < .76 THEN 'SURABAYA' WHEN r < .89 THEN 'MEDAN' ELSE 'SEMARANG' END;
    full_name := first_names[1 + (i - 1) % 30] || ' ' || last_names[1 + ((i - 1) / 30)];
    IF i % 20 = 0 THEN full_name := 'PT ' || last_names[1 + (i / 20) % 20] || ' Digital ' || initcap(branch_name); END IF;
    created_time := LEAST(as_of, CASE
      WHEN i <= 120 THEN starts_at + random() * interval '5 days'
      WHEN i <= 210 THEN starts_at + interval '1 month' + random() * interval '5 days'
      ELSE current_month + random() * (as_of - current_month) END);
    INSERT INTO customers(id, name, email, phone, city, address, segment, status, branch, notes, "ownerId", "createdAt", "updatedAt")
    VALUES ('hist-v1-customer-' || lpad(i::text, 4, '0'), full_name,
      'customer.' || lpad(i::text, 4, '0') || '@history.example',
      '+62812' || lpad((73000000 + i)::text, 8, '0'), initcap(branch_name),
      (ARRAY['Jl. Sudirman','Jl. Diponegoro','Jl. Ahmad Yani','Jl. Merdeka','Jl. Gajah Mada'])[1 + i % 5] || ' No. ' || (10 + i % 170),
      CASE WHEN i % 20 = 0 THEN 'CORPORATE' WHEN i % 5 = 0 THEN 'VIP' ELSE 'REGULAR' END,
      CASE WHEN i <= 60 THEN 'INACTIVE' ELSE 'ACTIVE' END::"CustomerStatus", branch_name::"Branch",
      CASE WHEN i <= 60 THEN 'Dormant: no purchase or completed contact in the last 45 days. Plan a consent-based reactivation offer.'
        WHEN i % 20 = 0 THEN 'Corporate buyer: recurring employee onboarding and replacement devices; procurement approval required.'
        WHEN i % 5 = 0 THEN 'Returning family buyer; interested in upgrades, official warranty, and trade-in programmes.'
        ELSE 'Prefers WhatsApp availability checks before visiting the store. Offers should include installment terms.' END,
      sales_ids[1 + (i + array_position(branches, branch_name)) % cardinality(sales_ids)], created_time, created_time);
  END LOOP;

  FOR i IN 1..500 LOOP
    customer_number := CASE WHEN i <= 300 THEN i ELSE 1 + (i * 73) % 300 END;
    SELECT * INTO STRICT customer_row FROM customers WHERE id = 'hist-v1-customer-' || lpad(customer_number::text, 4, '0');
    created_time := customer_row."createdAt" + random() * LEAST(interval '3 days', as_of - customer_row."createdAt");
    INSERT INTO contacts(id, name, email, phone, title, "customerId", "createdAt", "updatedAt")
    VALUES ('hist-v1-contact-' || lpad(i::text, 4, '0'),
      CASE WHEN i <= 300 AND customer_row.segment <> 'CORPORATE' THEN customer_row.name
        ELSE first_names[1 + (i * 7) % 30] || ' ' || last_names[1 + (i * 11) % 20] END,
      'contact.' || lpad(i::text, 4, '0') || '@history.example', '+62813' || lpad((74000000 + i)::text, 8, '0'),
      CASE WHEN customer_row.segment = 'CORPORATE' THEN (ARRAY['Procurement manager','Finance approver','IT coordinator'])[1 + i % 3]
        WHEN i <= 300 THEN 'Primary contact' ELSE (ARRAY['Spouse / family contact','Alternative pickup contact'])[1 + i % 2] END,
      customer_row.id, created_time, created_time);
  END LOOP;

  FOR i IN 1..250 LOOP
    customer_number := CASE WHEN i <= 60 THEN i + 60 WHEN i <= 95 THEN i - 60 WHEN i <= 150 THEN i + 25 ELSE NULL END;
    IF customer_number IS NOT NULL THEN
      SELECT * INTO STRICT customer_row FROM customers WHERE id = 'hist-v1-customer-' || lpad(customer_number::text, 4, '0');
      created_time := customer_row."createdAt" + interval '1 day';
      full_name := customer_row.name;
      branch_name := customer_row.branch::text;
    ELSE
      created_time := GREATEST(starts_at, as_of - random() * interval '18 days');
      full_name := first_names[1 + (i * 13) % 30] || ' ' || last_names[11 + i % 10];
      branch_name := branches[1 + i % 5];
    END IF;
    created_time := LEAST(created_time, as_of);
    r := random();
    source_name := CASE WHEN r < .30 THEN 'WALK_IN' WHEN r < .47 THEN 'WEBSITE'
      WHEN r < .65 THEN 'INSTAGRAM' WHEN r < .73 THEN 'FACEBOOK'
      WHEN r < .85 THEN 'REFERRAL' WHEN r < .94 THEN 'MARKETPLACE' ELSE 'TIKTOK' END;
    status_name := CASE WHEN i <= 60 THEN 'CONVERTED' WHEN i <= 95 THEN 'LOST'
      WHEN i <= 150 THEN 'QUALIFIED' WHEN i <= 190 THEN 'CONTACTED' ELSE 'NEW' END;
    SELECT * INTO product_row FROM history_catalogue ORDER BY -ln(GREATEST(random(), .000001)) / weight LIMIT 1;
    entity_id := 'hist-v1-lead-' || lpad(i::text, 4, '0');
    INSERT INTO leads(id, name, email, phone, source, status, branch, interest, notes, "customerId", "ownerId", "createdAt", "updatedAt")
    VALUES (entity_id, full_name, 'lead.' || lpad(i::text, 4, '0') || '@history.example', '+62815' || lpad((75000000 + i)::text, 8, '0'),
      source_name::"LeadSource", status_name::"LeadStatus", branch_name::"Branch", product_row.name,
      CASE WHEN i <= 150 THEN 'Upgrade enquiry; linked customer and opportunity tracked by the branch team.'
        ELSE 'Requested stock confirmation, installment options, and a comparison with a competing model.' END,
      CASE WHEN customer_number IS NOT NULL THEN customer_row.id ELSE NULL END,
      CASE WHEN customer_number IS NOT NULL THEN customer_row."ownerId" ELSE sales_ids[1 + i % cardinality(sales_ids)] END,
      created_time, created_time);
    IF i <= 150 THEN
      stage_name := CASE WHEN i <= 60 THEN 'WON' WHEN i <= 95 THEN 'LOST' WHEN i <= 110 THEN 'PROSPECTING'
        WHEN i <= 125 THEN 'QUALIFIED' WHEN i <= 140 THEN 'PROPOSAL' ELSE 'NEGOTIATION' END;
      created_time := LEAST(as_of, created_time + interval '1 day');
      closed_time := CASE WHEN i <= 95 THEN LEAST(as_of, created_time + (5 + random() * 12) * interval '1 day')
        ELSE as_of + (3 + random() * 21) * interval '1 day' END;
      INSERT INTO opportunities(id, name, stage, branch, value, probability, "expectedCloseDate", "lostReason", notes, "customerId", "ownerId", "createdAt", "updatedAt")
      VALUES ('hist-v1-opportunity-' || lpad(i::text, 4, '0'), product_row.name || ' - ' || full_name,
        stage_name::"OpportunityStage", branch_name::"Branch", product_row.price,
        CASE stage_name WHEN 'WON' THEN 100 WHEN 'LOST' THEN 0 WHEN 'PROSPECTING' THEN 15 WHEN 'QUALIFIED' THEN 35 WHEN 'PROPOSAL' THEN 60 ELSE 80 END,
        closed_time,
        CASE WHEN i BETWEEN 61 AND 95 THEN (ARRAY['Competitor offered a lower price','Financing application declined','Preferred colour unavailable','Upgrade deferred for budget reasons','Customer chose to repair existing device'])[1 + i % 5] ELSE NULL END,
        'Lead reference: ' || entity_id || '. Discuss official warranty, trade-in assessment, and branch collection.',
        customer_row.id, customer_row."ownerId", created_time, CASE WHEN i <= 95 THEN closed_time ELSE LEAST(as_of, created_time + interval '2 days') END);
    END IF;
  END LOOP;

  -- Daily weighting creates weekend, payday and double-date promotion peaks, plus a mid-month lull.
  CREATE TEMP TABLE history_days ON COMMIT DROP AS
  SELECT d::date AS day, date_trunc('month', d) AS month,
    LEAST(d + interval '3 hours', as_of) AS opens,
    LEAST(d + interval '14 hours', as_of) AS closes,
    (CASE WHEN extract(isodow FROM d) IN (6,7) THEN 1.65 ELSE 1 END *
     CASE WHEN extract(day FROM d) BETWEEN 25 AND 28 THEN 1.6 ELSE 1 END *
     CASE WHEN extract(day FROM d) = extract(month FROM d) THEN 2.4 ELSE 1 END *
     CASE WHEN extract(day FROM d) BETWEEN 12 AND 18 THEN .65 ELSE 1 END)::double precision AS weight
  FROM generate_series(starts_at, date_trunc('day', as_of), interval '1 day') d;
  progress := extract(epoch FROM (as_of - current_month)) / extract(epoch FROM (current_month + interval '1 month' - current_month));
  denominator := .92 + 1.30 + progress;
  month_counts := ARRAY[round(1000 * .92 / denominator)::integer, round(1000 * 1.30 / denominator)::integer, 0];
  month_counts[3] := 1000 - month_counts[1] - month_counts[2];
  pending_count := LEAST(20, month_counts[3] / 4);

  FOR m IN 0..2 LOOP
    FOR j IN 1..month_counts[m + 1] LOOP
      serial := serial + 1;
      linked_opportunity := NULL;
      earliest_time := starts_at + m * interval '1 month';
      IF serial <= 60 THEN
        linked_opportunity := 'hist-v1-opportunity-' || lpad(serial::text, 4, '0');
        SELECT * INTO STRICT opportunity_row FROM opportunities WHERE id = linked_opportunity;
        earliest_time := opportunity_row."createdAt";
      END IF;
      status_name := CASE WHEN serial <= 60 THEN 'COMPLETED'
        WHEN m = 2 AND j > month_counts[3] - pending_count THEN 'PENDING'
        WHEN serial % 19 = 0 THEN 'CANCELLED' ELSE 'COMPLETED' END;
      IF status_name = 'PENDING' THEN earliest_time := GREATEST(earliest_time, as_of - interval '2 days'); END IF;
      SELECT * INTO STRICT day_row FROM history_days
        WHERE month = starts_at + m * interval '1 month' AND closes >= earliest_time
        ORDER BY -ln(GREATEST(random(), .000001)) / weight LIMIT 1;
      event_time := GREATEST(day_row.opens, earliest_time) + random() * (day_row.closes - GREATEST(day_row.opens, earliest_time));
      IF linked_opportunity IS NOT NULL THEN
        SELECT * INTO STRICT customer_row FROM customers WHERE id = opportunity_row."customerId";
      ELSE
        SELECT * INTO STRICT customer_row FROM customers
          WHERE id LIKE 'hist-v1-customer-%' AND "createdAt" <= event_time
            AND (status = 'ACTIVE' OR event_time <= inactive_cutoff)
          ORDER BY -ln(GREATEST(random(), .000001)) /
            CASE segment WHEN 'CORPORATE' THEN 4 WHEN 'VIP' THEN 2 ELSE 1 END LIMIT 1;
      END IF;
      SELECT * INTO STRICT product_row FROM history_catalogue
        ORDER BY -ln(GREATEST(random(), .000001)) / weight LIMIT 1;
      IF serial = 1 THEN SELECT * INTO STRICT product_row FROM history_catalogue WHERE n = 12; END IF;
      IF serial = 2 THEN SELECT * INTO STRICT product_row FROM history_catalogue WHERE n = 13; END IF;
      unit_price := GREATEST(2000000, round(product_row.price * CASE WHEN serial <= 2 THEN 1 ELSE (1 - (serial % 4) * .015) END / 1000) * 1000);
      quantity := CASE WHEN serial > 2 AND serial % 9 = 0 AND unit_price <= 10000000 THEN 2 ELSE 1 END;
      sale_total := unit_price * quantity;
      entity_id := 'hist-v1-sale-' || lpad(serial::text, 4, '0');
      INSERT INTO sales_transactions(id, invoice, branch, "opportunityId", "customerId", "salespersonId", status, "soldAt", total, notes, "createdAt", "updatedAt")
      VALUES (entity_id, 'NV-HIST-' || to_char(event_time, 'YYYYMM') || '-' || lpad(serial::text, 4, '0'),
        customer_row.branch, linked_opportunity, customer_row.id, customer_row."ownerId", status_name::"TransactionStatus", event_time, sale_total,
        CASE WHEN status_name = 'PENDING' THEN 'Awaiting installment approval or bank transfer; stock is not reserved.'
          WHEN status_name = 'CANCELLED' THEN 'Order cancelled before collection; no stock movement or recognized revenue.'
          ELSE (ARRAY['QRIS payment confirmed.','Debit card payment settled.','Credit-card installment approved.','Bank transfer confirmed.'])[1 + serial % 4]
            || ' ' || initcap(customer_row.branch::text) || ' branch; official warranty activated at pickup.' END,
        event_time, event_time);
      INSERT INTO sales_transaction_items(id, "transactionId", "productId", quantity, "unitPrice", subtotal)
      VALUES (entity_id || '-item-1', entity_id, product_row.product_id, quantity, unit_price, sale_total);
      IF serial > 2 AND serial % 11 = 0 AND sale_total <= 20000000 THEN
        SELECT * INTO second_product FROM history_catalogue
          WHERE product_id <> product_row.product_id AND price <= 25000000 - sale_total
          ORDER BY -ln(GREATEST(random(), .000001)) / weight LIMIT 1;
        IF FOUND THEN
          INSERT INTO sales_transaction_items(id, "transactionId", "productId", quantity, "unitPrice", subtotal)
          VALUES (entity_id || '-item-2', entity_id, second_product.product_id, 1, second_product.price, second_product.price);
          sale_total := sale_total + second_product.price;
          UPDATE sales_transactions SET total = sale_total WHERE id = entity_id;
        END IF;
      END IF;
      IF linked_opportunity IS NOT NULL THEN
        UPDATE opportunities SET value = sale_total, "expectedCloseDate" = event_time, "updatedAt" = event_time,
          name = product_row.name || ' - ' || customer_row.name,
          notes = notes || ' Won invoice: NV-HIST-' || to_char(event_time, 'YYYYMM') || '-' || lpad(serial::text, 4, '0')
          WHERE id = linked_opportunity;
        UPDATE leads SET interest = product_row.name, "updatedAt" = event_time
          WHERE id = 'hist-v1-lead-' || lpad(serial::text, 4, '0');
      END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1..3000 LOOP
    status_name := CASE WHEN i % 20 = 0 THEN 'PLANNED' WHEN i % 25 = 0 THEN 'CANCELLED' ELSE 'COMPLETED' END;
    SELECT * INTO STRICT customer_row FROM customers
      WHERE id LIKE 'hist-v1-customer-%' AND (status_name <> 'PLANNED' OR status = 'ACTIVE')
      ORDER BY random() LIMIT 1;
    IF status_name = 'PLANNED' THEN
      created_time := GREATEST(customer_row."createdAt", as_of - random() * interval '5 days');
      event_time := as_of + random() * interval '7 days';
    ELSE
      event_time := customer_row."createdAt" + random() *
        (CASE WHEN customer_row.status = 'INACTIVE' THEN inactive_cutoff ELSE as_of END - customer_row."createdAt");
      created_time := GREATEST(customer_row."createdAt", event_time - random() * interval '2 days');
    END IF;
    SELECT * INTO opportunity_row FROM opportunities WHERE "customerId" = customer_row.id AND "createdAt" <= created_time ORDER BY "createdAt" DESC LIMIT 1;
    linked_opportunity := CASE WHEN FOUND THEN opportunity_row.id ELSE NULL END;
    SELECT * INTO product_row FROM history_catalogue ORDER BY -ln(GREATEST(random(), .000001)) / weight LIMIT 1;
    r := random();
    activity_type := CASE WHEN r < .34 THEN 'WHATSAPP' WHEN r < .59 THEN 'CALL' WHEN r < .78 THEN 'FOLLOW_UP'
      WHEN r < .88 THEN 'EMAIL' WHEN r < .96 THEN 'STORE_VISIT' ELSE 'MEETING' END;
    INSERT INTO activities(id, subject, type, status, branch, "dueAt", notes, "customerId", "opportunityId", "ownerId", "createdAt", "updatedAt")
    VALUES ('hist-v1-activity-' || lpad(i::text, 4, '0'),
      (CASE activity_type WHEN 'WHATSAPP' THEN 'Share stock and installment offer'
        WHEN 'CALL' THEN 'Discuss upgrade preferences' WHEN 'FOLLOW_UP' THEN 'Follow up on device comparison'
        WHEN 'EMAIL' THEN 'Send quotation and warranty details' WHEN 'STORE_VISIT' THEN 'In-store demo and trade-in assessment'
        ELSE 'Review employee device requirements' END) || ' - ' || customer_row.name,
      activity_type::"ActivityType", status_name::"ActivityStatus", customer_row.branch, event_time,
      product_row.name || '; ' || initcap(customer_row.branch::text) || ' branch. ' ||
        CASE status_name WHEN 'PLANNED' THEN 'Confirm the preferred contact time before reaching out.'
          WHEN 'CANCELLED' THEN 'Customer asked to reschedule; no purchase commitment.'
          ELSE (ARRAY['Compared camera quality and battery life.','Explained official warranty and service coverage.','Discussed 6- and 12-month installment options.','Confirmed storage capacity and preferred colour.','Reviewed trade-in condition and collection availability.','Shared family bundle and replacement-device options.'])[1 + i % 6] END,
      customer_row.id, linked_opportunity, customer_row."ownerId", created_time,
      CASE WHEN status_name = 'PLANNED' THEN created_time ELSE event_time END);
  END LOOP;

  SELECT jsonb_build_object(
    'customers', (SELECT count(*) FROM customers WHERE id LIKE 'hist-v1-customer-%'),
    'contacts', (SELECT count(*) FROM contacts WHERE id LIKE 'hist-v1-contact-%'),
    'leads', (SELECT count(*) FROM leads WHERE id LIKE 'hist-v1-lead-%'),
    'opportunities', (SELECT count(*) FROM opportunities WHERE id LIKE 'hist-v1-opportunity-%'),
    'activities', (SELECT count(*) FROM activities WHERE id LIKE 'hist-v1-activity-%'),
    'transactions', (SELECT count(*) FROM sales_transactions WHERE id LIKE 'hist-v1-sale-%')
  ) INTO batch_counts;
  IF batch_counts <> '{"customers":300,"contacts":500,"leads":250,"opportunities":150,"activities":3000,"transactions":1000}'::jsonb THEN
    RAISE EXCEPTION 'Historical batch count mismatch: %', batch_counts;
  END IF;
  INSERT INTO seed_batches(id, "periodStart", "periodEnd", counts, "createdAt")
    VALUES (batch_key, starts_at, as_of, batch_counts, timezone('UTC', now()));
  RAISE NOTICE 'Loaded historical retail batch: %', batch_counts;
END
$history$;
