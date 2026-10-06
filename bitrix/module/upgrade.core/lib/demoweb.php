<?php
declare(strict_types=1);
namespace Upgrade\Core;

/** Own HTTP boundary. Server metadata/snapshot are caller-verified; all form bytes are untrusted. */
final class DemoWeb
{
    private const PREFIX='/__upgrade/';
    private const READ_ROUTES=['search','cart','lead','receipt'];
    private const SORTS=['relevance','title_asc','title_desc','price_asc','price_desc'];

    public static function handle(DemoEngine $engine,array $snapshot,array $request): array
    {
        $headers=['Content-Type'=>'text/html; charset=UTF-8','Cache-Control'=>'no-store','X-Robots-Tag'=>'noindex, nofollow','X-Content-Type-Options'=>'nosniff','Referrer-Policy'=>'same-origin'];
        $head=($request['method']??null)==='HEAD';
        try {
            self::need(is_string($request['method']??null)&&preg_match('/\A[A-Z]{1,16}\z/D',$request['method'])===1,'REQUEST_INVALID');
            $method=$request['method'];$target=$request['request_target']??null;
            self::need(is_string($target)&&strlen($target)<=8192&&str_starts_with($target,'/')&&!str_starts_with($target,'//')&&!preg_match('/[\x00-\x20\x7f\\\\#]/',$target),'REQUEST_INVALID');
            self::need(is_bool($request['https']??null)&&self::host($request['host']??null),'REQUEST_INVALID');
            self::need(is_string($request['body']??null)&&strlen($request['body'])<=8192,'INPUT_LIMIT');
            self::need(($snapshot['schema_version']??null)===1&&self::hex($snapshot['snapshot_id']??null)&&is_array($snapshot['items']??null),'SNAPSHOT_INVALID');
            $path=explode('?',$target,2)[0];$own=str_starts_with($path,self::PREFIX)||$path==='/__upgrade';
            $route=$own?substr($path,strlen(self::PREFIX)):null;
            if($own&&!in_array($route,[...self::READ_ROUTES,'action'],true))return self::error(404,'NOT_FOUND',$headers,$head);
            $allowed=$route==='action'?['POST']:['GET','HEAD'];
            if(!in_array($method,$allowed,true))return self::error(405,'METHOD_NOT_ALLOWED',$headers+['Allow'=>implode(', ',$allowed)],$head);
            if($method!=='POST')self::need($request['body']==='','UNEXPECTED_INPUT');
            $items=[];foreach($snapshot['items'] as $item){self::need(is_array($item)&&is_string($item['id']??null),'SNAPSHOT_INVALID');$items[$item['id']]=$item;}
            if(!$own){$item=$items[$request['item_id']??'']??null;if(!is_array($item)||($item['is_product']??null)!==true)return self::response(200,$headers,null);$route='product';}
            $params=$own?self::parse(explode('?',$target,2)[1]??''):[];
            $cookie=$request['cookie']??null;
            // A raw Cookie header is deliberately not accepted here. The caller must reject duplicates
            // and pass exactly one opaque value; unknown tokens never become chosen new session IDs.
            $session=self::hex($cookie)?$cookie:null;
            if($method==='POST'){
                self::need(!$params,'UNEXPECTED_INPUT');
                self::need(is_string($request['content_type']??null)&&preg_match('/\Aapplication\/x-www-form-urlencoded(?:\s*;\s*charset=UTF-8)?\z/Di',$request['content_type'])===1,'CONTENT_TYPE_INVALID');
                self::need(is_string($request['origin']??null)&&hash_equals(($request['https']?'https':'http').'://'.$request['host'],$request['origin']),'ORIGIN_INVALID');
                self::need($session!==null,'SESSION_REQUIRED');
                $form=self::parse($request['body']);[$action,$payload]=self::mutation($form);
                $opened=$engine->resumeSession($session);self::need(is_array($opened),'SESSION_REQUIRED');self::binding($opened['cart'],$snapshot);
                $result=$engine->mutate($session,$form['csrf'],$form['idempotency_key'],$action,$payload);
                self::need(self::hex($result['operation_id']??null),'RESPONSE_INVALID');
                $destination=str_starts_with($action,'cart.')?'cart':'receipt';
                return self::response(303,$headers+['Location'=>self::PREFIX.$destination.'?operation='.$result['operation_id']],null);
            }
            $view=['kind'=>$route,'csrf'=>null,'snapshot_id'=>$snapshot['snapshot_id'],'cart'=>null,'item'=>null,'search'=>null,'query'=>[],'record'=>null,'message'=>null,'items'=>$items];
            if($route==='search'){
                [$filters,$categories,$limited]=self::facets($items);
                $query=self::searchQuery($params,$filters);$engineFilters=['attributes'=>[]];
                if($query['category']!=='')$engineFilters['category_id']=$query['category'];
                foreach($filters as $filter)if(isset($query['attributes'][$filter['key']]))$engineFilters['attributes'][$filter['name']]=[$query['attributes'][$filter['key']]];
                $view['search']=$engine->search($query['q'],$engineFilters,$query['sort'],$query['page'],20);self::binding($view['search'],$snapshot);
                $view['query']=$query;$view['filters']=$filters;$view['categories']=$categories;$view['facets_limited']=$limited;
                return self::response(200,$headers,$head?null:$view);
            }
            self::keys($params,$route==='lead'?['item_id']:($route==='cart'||$route==='receipt'?['operation']:[]));
            if(isset($params['operation']))self::need(self::hex($params['operation']),'INPUT_INVALID');
            if($route==='receipt')self::need(isset($params['operation']),'NOT_FOUND');
            if($route==='lead'&&isset($params['item_id']))self::need(isset($items[$params['item_id']]),'ITEM_NOT_FOUND');
            $opened=$session!==null?$engine->resumeSession($session):null;
            if(!is_array($opened)){
                if($route==='receipt'||isset($params['operation']))return self::error(404,'NOT_FOUND',$headers,$head);
                if($head)return self::response(200,$headers,null);
                $session=bin2hex(random_bytes(32));$opened=$engine->openSession($session);
                $headers['Set-Cookie']='upgrade_demo_session='.$session.'; Path=/; HttpOnly; SameSite=Strict'.($request['https']?'; Secure':'');
            }
            self::binding($opened['cart'],$snapshot);$view['csrf']=$opened['csrf'];$view['cart']=$opened['cart'];
            if($route==='product')$view['item']=$item;
            if($route==='lead'){$view['query']=$params;if(isset($params['item_id']))$view['item']=$items[$params['item_id']];}
            if(isset($params['operation'])){
                $operation=$engine->receipt($session,$params['operation']);
                if(!is_array($operation)||($route==='receipt'&&!is_array($operation['record']??null)))return self::error(404,'NOT_FOUND',$headers,$head);
                $view['operation']=$operation;$view['record']=$operation['record'];
            }
            return self::response(200,$headers,$head?null:$view);
        } catch(\Throwable $error) {
            // Only Runtime may retry this read-only attempt under quota admission.
            // All ordinary state errors remain errors, never permission to recreate a session.
            if($error instanceof DemoAdmissionRequired)throw $error;
            // Exception text can contain paths or source strings. Only a fixed allowlist is public.
            $code=$error->getMessage();$status=match($code){
                'NOT_FOUND','ITEM_NOT_FOUND','CART_LINE_NOT_FOUND'=>404,
                'METHOD_NOT_ALLOWED'=>405,'CONTENT_TYPE_INVALID'=>415,
                'ORIGIN_INVALID','SESSION_REQUIRED','CSRF_INVALID'=>403,
                'SNAPSHOT_CHANGED','IDEMPOTENCY_CONFLICT'=>409,
                'STATE_BUSY','SESSION_OPERATION_LIMIT','SYNTHETIC_RECORD_LIMIT','STATE_LIMIT'=>503,
                'INPUT_LIMIT'=>413,
                'REQUEST_INVALID','UNEXPECTED_INPUT','INPUT_INVALID','SEARCH_LIMIT','SORT_INVALID','FILTER_INVALID','TEXT_INVALID','IDEMPOTENCY_KEY_INVALID','ACTION_INVALID','SYNTHETIC_DATA_REQUIRED','LEAD_TOPIC_INVALID','CHECKOUT_MODE_INVALID'=>400,
                'NOT_PRODUCT','VARIANT_REQUIRED','VARIANT_NOT_FOUND','QUANTITY_INVALID','QUANTITY_OUT_OF_RANGE','QUANTITY_BELOW_MINIMUM','QUANTITY_ABOVE_MAXIMUM','QUANTITY_STEP_MISMATCH','CART_LINE_LIMIT','CART_NOT_CHECKOUT_ELIGIBLE','PRICE_SORT_INCOMPARABLE'=>422,
                default=>500,
            };
            return self::error($status,$status===500?'DEMO_UNAVAILABLE':$code,$headers,$head);
        }
    }

    private static function need(bool $condition,string $code): void {if(!$condition)throw new \RuntimeException($code);}
    private static function hex(mixed $value): bool {return is_string($value)&&preg_match('/\A[a-f0-9]{64}\z/D',$value)===1;}
    private static function host(mixed $value): bool
    {
        if(!is_string($value)||strlen($value)>260||!preg_match('/\A(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?\z/D',$value))return false;
        $parts=parse_url('http://'.$value);return is_array($parts)&&isset($parts['host'])&&(!isset($parts['port'])||($parts['port']>=1&&$parts['port']<=65535));
    }
    private static function binding(array $value,array $snapshot): void {self::need(($value['snapshot_id']??null)===$snapshot['snapshot_id'],'SNAPSHOT_INVALID');}
    private static function keys(array $value,array $allowed): void {self::need(!array_diff(array_keys($value),$allowed),'UNEXPECTED_INPUT');}
    private static function parse(string $bytes): array
    {
        self::need(strlen($bytes)<=8192,'INPUT_LIMIT');if($bytes==='')return [];$pairs=explode('&',$bytes);self::need(count($pairs)<=32,'INPUT_LIMIT');$result=[];
        foreach($pairs as $pair){self::need($pair!==''&&str_contains($pair,'='),'INPUT_INVALID');[$key,$value]=explode('=',$pair,2);
            self::need(!preg_match('/%(?![a-fA-F0-9]{2})/',$key.$value),'INPUT_INVALID');$key=urldecode($key);$value=urldecode($value);
            self::need(preg_match('/\A[a-z][a-z0-9_]{0,39}\z/D',$key)===1&&!array_key_exists($key,$result),'INPUT_INVALID');
            self::need(strlen($value)<=2000&&preg_match('//u',$value)===1&&!preg_match('/[\x00-\x1f\x7f]/',$value),'INPUT_INVALID');$result[$key]=$value;
        }return $result;
    }
    private static function mutation(array $form): array
    {
        $action=$form['action']??'';$allowed=match($action){
            'cart.add'=>['item_id','variant_id','quantity'],'cart.update'=>['line_id','quantity'],'cart.remove'=>['line_id'],
            'demo.lead'=>['synthetic','identity','consent','topic','item_id'],'demo.checkout'=>['synthetic','identity','consent','delivery','payment'],
            default=>throw new \RuntimeException('ACTION_INVALID'),
        };
        self::keys($form,['action','csrf','expected_snapshot_id','idempotency_key',...$allowed]);
        self::need(self::hex($form['csrf']??null),'CSRF_INVALID');self::need(self::hex($form['expected_snapshot_id']??null),'INPUT_INVALID');
        self::need(is_string($form['idempotency_key']??null)&&preg_match('/\A[A-Za-z0-9][A-Za-z0-9._:-]{15,127}\z/D',$form['idempotency_key'])===1,'IDEMPOTENCY_KEY_INVALID');
        $payload=['expected_snapshot_id'=>$form['expected_snapshot_id']];foreach($allowed as $key)if(array_key_exists($key,$form))$payload[$key]=$form[$key];
        if(str_starts_with($action,'demo.')){self::need(($payload['synthetic']??null)==='1'&&($payload['consent']??null)==='1'&&($payload['identity']??null)==='demo-customer','SYNTHETIC_DATA_REQUIRED');$payload['synthetic']=true;$payload['consent']=true;}
        if($action==='cart.add'&&isset($payload['variant_id'])&&$payload['variant_id']==='')unset($payload['variant_id']);
        return [$action,$payload];
    }
    private static function facets(array $items): array
    {
        $names=[];$categories=[];$limited=false;
        foreach($items as $item){foreach(array_keys($item['attributes']??[]) as $name)$names[$name]=true;foreach($item['category_ids']??[] as $id)$categories[$id]=true;
            ksort($names,SORT_STRING);if(count($names)>20){$limited=true;$names=array_slice($names,0,20,true);}ksort($categories,SORT_STRING);if(count($categories)>200){$limited=true;$categories=array_slice($categories,0,200,true);}}
        $filters=[];foreach(array_keys($names) as $name){$values=[];foreach($items as $item){foreach($item['attributes'][$name]??[] as $value)$values[$value]=true;ksort($values,SORT_STRING);if(count($values)>200){$limited=true;$values=array_slice($values,0,200,true);}}
            $filters[]=['key'=>'a'.count($filters),'name'=>(string)$name,'label'=>(string)$name,'values'=>array_map('strval',array_keys($values))];}
        return [$filters,array_map(static fn($id)=>['id'=>(string)$id,'label'=>is_string($items[$id]['title']??null)?$items[$id]['title']:(string)$id],array_keys($categories)),$limited];
    }
    private static function searchQuery(array $params,array $filters): array
    {
        self::keys($params,['q','category','sort','page',...array_column($filters,'key')]);$q=$params['q']??'';$category=$params['category']??'';$sort=$params['sort']??'relevance';$page=$params['page']??'1';
        self::need(strlen($q)<=1000&&mb_strlen($q,'UTF-8')<=200&&strlen($category)<=240,'SEARCH_LIMIT');self::need(in_array($sort,self::SORTS,true),'SORT_INVALID');self::need(preg_match('/\A[1-9][0-9]{0,4}\z/D',$page)===1&&(int)$page<=10000,'SEARCH_LIMIT');$attributes=[];
        foreach($filters as $filter)if(isset($params[$filter['key']])&&$params[$filter['key']]!==''){self::need(in_array($params[$filter['key']],$filter['values'],true),'FILTER_INVALID');$attributes[$filter['key']]=$params[$filter['key']];}
        return ['q'=>$q,'category'=>$category,'sort'=>$sort,'page'=>(int)$page,'attributes'=>$attributes];
    }
    private static function response(int $status,array $headers,?array $view): array {return ['status'=>$status,'headers'=>$headers,'view'=>$view];}
    private static function error(int $status,string $code,array $headers,bool $head): array
    {
        $message=match($status){403=>'Форма недействительна. Откройте страницу заново.',404=>'Страница или результат не найдены.',405=>'Этот способ запроса не поддерживается.',409=>'Данные изменились или ключ операции уже использован. Проверьте корзину.',413=>'Запрос превышает допустимый размер.',415=>'Неподдерживаемый формат формы.',422=>'Проверьте количество, выбранный вариант и доступность сценария.',500,503=>'Демо временно недоступно. Повторите проверку позднее.',default=>'Проверьте параметры формы.'};
        return self::response($status,$headers,$head?null:['kind'=>'error','csrf'=>null,'snapshot_id'=>null,'cart'=>null,'item'=>null,'search'=>null,'query'=>[],'record'=>null,'message'=>$message,'error_code'=>$code,'items'=>[]]);
    }
}
