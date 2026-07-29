-- =============================================================================
-- EIP 權限自我檢查腳本
--
-- 用途：任何時候（尤其是 Lovable 推了新版、或改了角色／部門設定之後）
--       貼進 Supabase SQL Editor 整份執行，就能知道權限有沒有跑掉。
--
-- 安全性：全部包在 `raise exception` 裡結束，所以**整份都會回滾**，
--         正式庫不會留下任何測試資料。看到紅字 ERROR 是正常的 ——
--         那就是報告本身。真正要看的是訊息內容裡有沒有 ★。
--
-- 怎麼看結果：訊息裡出現 ★ 就是有問題，沒有 ★ 就是通過。
--
-- 為什麼需要這個：前七輪的 bug 幾乎都是「只用管理者帳號測過」漏掉的。
--         最高權限者走的分支跟一般同仁完全不同，測 admin 等於沒測。
-- =============================================================================


-- =============================================================================
-- 【檢查 1】未登入（anon）不該看到任何資料，也不該噴看不懂的錯
-- 抓過的問題：2026-07-29 正式庫 48 分鐘內 25 次
--   「permission denied for function current_tenant_id」
--   —— token 過期時使用者看到紅色錯誤而不是「請重新登入」
-- =============================================================================
do $$
declare n int; r record; v_ok int := 0; v_fnerr int := 0; v_leak int := 0; v_msg text := '';
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role','anon', true);
  for r in select c.relname t from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
            where ns.nspname='public' and c.relkind='r' and c.relrowsecurity order by 1 loop
    begin
      execute format('select count(*) from public.%I', r.t) into n;
      if n = 0 then v_ok := v_ok + 1;
      else v_leak := v_leak + 1; v_msg := v_msg || format(E'\n  ★ %s 未登入看得到 %s 列', r.t, n); end if;
    exception
      when insufficient_privilege then
        if sqlerrm like '%for function%' then
          v_fnerr := v_fnerr + 1;
          v_msg := v_msg || format(E'\n  ★ %s 噴函式權限錯誤（使用者會看到紅字）', r.t);
        else v_ok := v_ok + 1; end if;
      when others then v_msg := v_msg || format(E'\n  ★ %s 非預期錯誤 %s', r.t, sqlstate);
    end;
  end loop;
  raise exception '%', format('【1 未登入掃描】乾淨 %s／函式權限錯誤 %s／看得到資料 %s%s',
    v_ok, v_fnerr, v_leak, coalesce(nullif(v_msg,''), ' → 全部通過'));
end $$;


-- =============================================================================
-- 【檢查 2】一般成員：可見範圍不可縮水、部門級報表必須擋、不可提權
-- 換人測：把 v_me 改成任一位一般成員的 id
--   select id, name from app_user where role='member' and status='active';
-- =============================================================================
do $$
declare
  v_me uuid; v_dept uuid; v_msg text := ''; n int; v_role text; v_admin_role uuid;
begin
  select id, department_id into v_me, v_dept from public.app_user
   where role='member' and status='active' and department_id is not null order by name limit 1;
  select id into v_admin_role from public.roles where name in ('管理者','company_admin') limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_me,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  -- 2a 可見範圍（有 0 就要查是不是政策改壞了）
  select count(*) into n from public.task;          v_msg := v_msg || format(E'\n  可見任務 %s', n);
  select count(*) into n from public.announcement;  v_msg := v_msg || format(E'／公告 %s', n);
  select count(*) into n from public.eip_document;  v_msg := v_msg || format(E'／文件 %s', n);
  select count(*) into n from public.notification;  v_msg := v_msg || format(E'／通知 %s', n);
  select count(*) into n from public.eip_my_routine_today(null);
  v_msg := v_msg || format(E'／今日例行 %s 項', n);
  select count(*) into n from public.eip_leave_roster(current_date-30, current_date+30);
  v_msg := v_msg || format(E'／請假名單 %s 筆', n);

  -- 2b 自己部門的「部門範圍」資料必須看得到（0157 收緊管轄時最容易誤傷這裡）
  if not public.eip_can_view_dept_record(v_dept) then
    v_msg := v_msg || E'\n  ★ 看不到自己部門的部門範圍資料（可見範圍被改壞了）';
  end if;
  -- 但「管轄」必須是 false（他不是主管）
  if public.eip_user_can_scope_dept(v_dept) then
    v_msg := v_msg || E'\n  ★ 一般成員取得了自己部門的管轄權';
  end if;

  -- 2c 部門級報表與催填必須全部擋掉
  begin perform * from public.eip_dept_routine_summary(current_date-6, current_date);
    v_msg := v_msg || E'\n  ★ 成員可讀 部門例行彙總';
  exception when others then null; end;
  begin perform * from public.eip_performance_by_dept(current_date-6, current_date);
    v_msg := v_msg || E'\n  ★ 成員可讀 依部門績效';
  exception when others then null; end;
  begin perform public.eip_nudge_worklog(array[v_me], current_date-1);
    v_msg := v_msg || E'\n  ★ 成員可用 催填';
  exception when others then null; end;
  begin perform * from public.eip_anomaly_weekly_kpi(current_date-30, current_date);
    v_msg := v_msg || E'\n  ★ 成員可讀 異常週KPI';
  exception when others then null; end;

  -- 2d 提權嘗試（重點：看「實際落地的值」，不要看 found／不報錯）
  begin perform public.eip_set_user_roles(v_me, array[v_admin_role]);
    v_msg := v_msg || E'\n  ★★ 成員可以呼叫 eip_set_user_roles 改自己的角色';
  exception when others then null; end;
  begin insert into public.user_roles(user_id, role_id) values (v_me, v_admin_role);
    v_msg := v_msg || E'\n  ★★ 成員可以直接寫 user_roles';
  exception when others then null; end;
  begin
    update public.app_user set role='company_admin' where id=v_me;
    select role into v_role from public.app_user where id=v_me;
    if v_role='company_admin' then v_msg := v_msg || E'\n  ★★ 成員把自己的 app_user.role 改成管理者且真的存進去了'; end if;
  exception when others then null; end;
  begin
    update public.department set manager_id=v_me where manager_id is not null;
    if found then v_msg := v_msg || E'\n  ★★ 成員可以把自己設成部門主管'; end if;
  exception when others then null; end;
  begin
    insert into public.eip_dept_supervisor(department_id, user_id)
      select id, v_me from public.department limit 1;
    v_msg := v_msg || E'\n  ★★ 成員可以把自己登記成部門督導';
  exception when others then null; end;
  begin
    update public.role_module_permissions set can_delete=true;
    if found then v_msg := v_msg || E'\n  ★★ 成員可以改 role_module_permissions'; end if;
  exception when others then null; end;
  select count(*) into n from public.notification where user_id <> v_me;
  if n > 0 then v_msg := v_msg || format(E'\n  ★★ 成員讀得到別人的通知 %s 筆', n); end if;

  raise exception '%', format('【2 一般成員（%s）】%s',
    (select name from public.app_user where id=v_me), v_msg);
end $$;


-- =============================================================================
-- 【檢查 3】管轄範圍必須來自「明確登記」，不是「所屬部門＋角色代碼」
-- 抓過的問題：曾義仁有 dept_manager 角色但不管任何部門，因為坐在總經理室，
--   取得全公司 17 個部門的 UPDATE/DELETE 權（0157／0158 修正）
-- =============================================================================
select u.name as 人員, u.role as 角色,
       coalesce((select string_agg(d.name,'、') from public.department d where d.manager_id=u.id),'（無）') as 掛名主管的部門,
       coalesce((select string_agg(d.name,'、') from public.eip_dept_supervisor s
                  join public.department d on d.id=s.department_id where s.user_id=u.id),'（無）') as 明確登記督導,
       (select count(*) from public.department d
         where exists (select 1 from (
                 select dd.id from public.department dd where dd.manager_id=u.id
                 union select s.department_id from public.eip_dept_supervisor s where s.user_id=u.id
               ) roots where public.eip_dept_in_subtree(d.id, roots.id))) as 可管部門數,
       case when u.role='dept_manager'
             and not exists (select 1 from public.department d where d.manager_id=u.id)
             and not exists (select 1 from public.eip_dept_supervisor s where s.user_id=u.id)
            then '★ 有主管角色但沒有任何管轄登記 —— 請確認是要登記還是要降回一般成員'
            else '' end as 需確認
from public.app_user u
where u.status='active' and u.role in ('dept_manager','company_admin')
order by u.role, u.name;


-- 每個部門都必須找得到一位「實際負責的在職主管」。
-- 規則（0159）：自己 → 父 → 祖父… 往上找第一個有在職 manager_id 或明確登記督導的部門。
-- 沒有直屬主管不是問題（會往上跑），★ 只會出現在「連往上都找不到」的情況，
-- 或是新增部門時整條線都沒指派。
with recursive tree as (
  select d.id, d.name, d.parent_id, 0 lvl, d.name::text path
    from public.department d where d.parent_id is null
  union all
  select d.id, d.name, d.parent_id, t.lvl+1, t.path||' > '||d.name
    from public.department d join tree t on d.parent_id = t.id
)
select repeat('　', t.lvl)||t.name as 部門,
       coalesce(mu.name,'（未指派）') as 掛的主管,
       coalesce(mu.status::text,'-') as 狀態,
       coalesce(eu.name,'★ 連往上都找不到在職主管') as 實際負責人,
       case when d.manager_id is not null and mu.status::text='active' then '直屬'
            when eu.id is null then '★ 無人'
            else '往上找到' end as 來源
from tree t
join public.department d on d.id = t.id
left join public.app_user mu on mu.id = d.manager_id
left join public.app_user eu on eu.id = public.eip_dept_effective_manager(d.id)
order by t.path;


-- =============================================================================
-- 【檢查 4】部門主管：管轄範圍內要能做事、範圍外要被擋
-- 換人測：改 v_mgr
-- =============================================================================
do $$
declare v_mgr uuid; v_in uuid; v_out uuid; v_msg text := ''; n int;
begin
  -- 挑一位「真的有管部門」的主管
  select u.id into v_mgr from public.app_user u
   where u.status='active' and u.role='dept_manager'
     and exists (select 1 from public.department d where d.manager_id=u.id)
   order by u.name limit 1;
  select a.id into v_in from public.app_user a
   where a.status='active' and a.id<>v_mgr and public.eip_dept_in_subtree(a.department_id,
     (select id from public.department where manager_id=v_mgr limit 1)) limit 1;
  select a.id into v_out from public.app_user a
   where a.status='active' and a.department_id is not null
     and not public.eip_dept_in_subtree(a.department_id,
       (select id from public.department where manager_id=v_mgr limit 1)) limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  begin select count(*) into n from public.eip_dept_routine_summary(current_date-6,current_date);
    v_msg := v_msg || format(E'\n  部門例行彙總 %s 列', n);
  exception when others then v_msg := v_msg || E'\n  ★ 部門例行彙總被擋（實際主管應該可讀）'; end;

  if v_in is not null then
    begin perform public.eip_nudge_worklog(array[v_in], current_date-1);
    exception when others then v_msg := v_msg || E'\n  ★ 催填管轄內同仁被擋'; end;
  end if;

  if v_out is not null then
    begin select count(*) into n from public.eip_performance_summary(current_date-6,current_date,null,v_out);
      v_msg := v_msg || format(E'\n  ★ 可讀管轄外同仁的績效（%s 列，應該擋）', n);
    exception when others then null; end;
  end if;

  raise exception '%', format('【4 部門主管（%s）】%s',
    (select name from public.app_user where id=v_mgr),
    coalesce(nullif(v_msg,''),' → 全部通過'));
end $$;


-- =============================================================================
-- 【檢查 5】結構衛生（不需要身分，直接看）
-- =============================================================================
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)          as 沒開RLS的表_應為0,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.proconfig is null)             as definer沒設search_path_應為0,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal and t.tgenabled='D')          as 停用的trigger_應為0,
  (select count(*) from cron.job where active)                                     as 啟用排程_應為7,
  (select count(*) from public.eip_quick_report
    where type='leave' and status='acknowledged' and deleted_at is null)          as 請假殘留acknowledged_應為0,
  -- anon 可呼叫的函式：預期 11 支，全部是政策判定器／身分讀取器，未登入回 false/NULL。
  -- 數字變大要查是不是有業務 RPC 被誤開；變小會讓未登入請求噴 42501（見檢查 1）。
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and has_function_privilege('anon', p.oid,'execute'))                         as anon可呼叫函式_預期11;


-- =============================================================================
-- 【檢查 6】外部服務的真實回應（LINE）
-- 重點：line-push 一律回 HTTP 200，真正狀態在 body 的 line_status。
--       只看 status_code 會把「額度用盡」誤判成「已恢復」。
-- =============================================================================
select date_trunc('hour', created) as 時段,
       count(*) as 呼叫次數,
       count(*) filter (where content like '%"line_status":200%') as 真的成功,
       count(*) filter (where content like '%"line_status":429%') as 額度用盡,
       count(*) filter (where status_code between 200 and 299) as HTTP成功_會騙人
from net._http_response
where created > now() - interval '48 hours'
group by 1 order by 1 desc;


-- =============================================================================
-- 【檢查 7】例行數字對帳（RPC 輸出 vs 從原始資料手算）
-- 抓過的問題：日誌建立之後才新增的範本當天不會出現，導致達成率永遠不滿（0153）
-- =============================================================================
with span as (select (now() at time zone 'Asia/Taipei')::date - 6 f,
                     (now() at time zone 'Asia/Taipei')::date t),
manual as (
  select (select count(*) from span, public.app_user a
            join public.personal_routine pr on pr.user_id=a.id and pr.is_active and pr.deleted_at is null
            cross join generate_series((select f from span),(select t from span), interval '1 day') d(dt)
           where a.status='active' and public.eip_personal_routine_due_on(pr, d.dt::date)) as exp_n,
         (select count(*) from span, public.work_log w
            cross join lateral jsonb_array_elements(
              coalesce(w.routine_morning,'[]'::jsonb) || coalesce(w.routine_afternoon,'[]'::jsonb)) it
           where w.deleted_at is null and w.log_date between (select f from span) and (select t from span)
             and (it->>'source')='personal_routine'
             and not coalesce((it->>'removed')::boolean,false)
             and coalesce((it->>'done')::boolean,false)) as done_n
)
select exp_n as 手算應做, done_n as 手算已做,
       '把這兩個數字跟「部門例行彙總」頁面上的磚對照，不一致就是口徑跑掉了' as 怎麼用
from manual;

-- 逐人核對「今日到期的範本數」與「工作區實際看到的項數」是否一致
-- （不一致＝補齊機制沒生效，使用者會說「我新增的例行沒出現」）
select a.name as 人員,
       (select count(*) from public.personal_routine pr
         where pr.user_id=a.id and pr.is_active and pr.deleted_at is null
           and public.eip_personal_routine_due_on(pr,(now() at time zone 'Asia/Taipei')::date)) as 今日到期範本,
       (select count(*) from public.work_log w
         cross join lateral jsonb_array_elements(
           coalesce(w.routine_morning,'[]'::jsonb)||coalesce(w.routine_afternoon,'[]'::jsonb)) it
        where w.user_id=a.id and w.log_date=(now() at time zone 'Asia/Taipei')::date
          and w.deleted_at is null and (it->>'source')='personal_routine'
          and not coalesce((it->>'removed')::boolean,false)) as 日誌裡的項數,
       '兩欄應該一致；日誌裡比較少＝補齊沒生效' as 說明
from public.app_user a
where a.status='active'
  and exists (select 1 from public.personal_routine pr
               where pr.user_id=a.id and pr.is_active and pr.deleted_at is null)
order by a.name;
