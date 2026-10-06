<?php
declare(strict_types=1);
namespace Upgrade\Core;

/** Internal control flow: a read-only attempt needs quota admission before any write. */
final class DemoAdmissionRequired extends \RuntimeException {}

/** Own isolated demo service. No CMS bootstrap, network, native orders, mail or arbitrary contact data. */
final class DemoEngine
{
    private const SCALE=1000000;
    private const MAX_QUANTITY=10000000000; // 10000 source units, scaled by 1e6.
    private const MAX_STATE_BYTES=8388608;
    private array $items=[];
    private string $directory;
    private string $snapshot;
    private bool $readOnly=false;
    public function __construct(array $snapshot,string $stateDir,private string $project)
    {
        self::need(PHP_INT_SIZE===8 && function_exists('mb_strtolower'),'RUNTIME_REQUIRED');
        self::need((bool)preg_match('/\A[a-z0-9][a-z0-9-]{0,62}\z/D',$project),'PROJECT_INVALID');
        self::need(($snapshot['schema_version']??null)===1 && ($snapshot['project_id']??null)===$project && is_string($snapshot['snapshot_id']??null) && preg_match('/\A[a-f0-9]{64}\z/D',$snapshot['snapshot_id']),'SNAPSHOT_INVALID');
        self::need(is_array($snapshot['items']??null) && array_is_list($snapshot['items']) && count($snapshot['items'])<=10000 && strlen(self::json($snapshot))<=67108864,'SNAPSHOT_LIMIT');
        $this->snapshot=$snapshot['snapshot_id'];
        foreach($snapshot['items'] as $item){
            self::need(is_array($item),'ITEM_INVALID');$id=self::text($item['id']??null,160);
            self::need(!isset($this->items[$id]) && is_bool($item['is_product']??null),'ITEM_INVALID');
            self::text($item['title']??null,5000);self::text($item['body_text']??'',2000000,true);
            $target=self::text($item['request_target']??null,8192);self::need(str_starts_with($target,'/')&&!str_starts_with($target,'//')&&!preg_match('/[\x00-\x20\x7f\\\\#]/',$target),'ITEM_ROUTE_INVALID');
            self::need(is_array($item['category_ids']??[]) && count($item['category_ids']??[])<=100 && is_array($item['attributes']??[]) && count($item['attributes']??[])<=100,'ITEM_FACETS_INVALID');
            foreach($item['category_ids']??[] as $value)self::text($value,240);
            foreach($item['attributes']??[] as $name=>$values){self::text($name,160);self::need(is_array($values)&&array_is_list($values)&&count($values)<=100,'ITEM_FACETS_INVALID');foreach($values as $value)self::text($value,500);}
            $variants=$item['variants']??[];self::need(is_array($variants)&&array_is_list($variants)&&count($variants)<=500,'VARIANTS_INVALID');$ids=[];
            foreach($variants as $variant){self::need(is_array($variant),'VARIANT_INVALID');$vid=self::text($variant['id']??null,160);self::need(!isset($ids[$vid]),'VARIANT_DUPLICATE');$ids[$vid]=true;}
            $item['variants']=$variants;$this->items[$id]=$item;
        }
        self::need($stateDir!=='' && !is_link($stateDir) && is_dir($stateDir),'PRIVATE_STATE_DIRECTORY_REQUIRED');
        $base=realpath($stateDir);self::need(is_string($base),'PRIVATE_STATE_DIRECTORY_REQUIRED');
        if(DIRECTORY_SEPARATOR==='/')self::need((fileperms($base)&0077)===0,'PRIVATE_STATE_PERMISSIONS_REQUIRED');
        $documentRoot=isset($_SERVER['DOCUMENT_ROOT'])?realpath((string)$_SERVER['DOCUMENT_ROOT']):false;
        self::need(!$documentRoot || ($base!==$documentRoot&&!str_starts_with($base,$documentRoot.DIRECTORY_SEPARATOR)),'STATE_INSIDE_WEBROOT');
        $this->directory=$base.DIRECTORY_SEPARATOR.'demo-'.$project;
        if(!is_dir($this->directory))self::need(@mkdir($this->directory,0700) || is_dir($this->directory),'STATE_CREATE_FAILED');
        self::need(!is_link($this->directory)&&realpath($this->directory)===$this->directory,'STATE_PATH_INVALID');
        if(DIRECTORY_SEPARATOR==='/')self::need((fileperms($this->directory)&0077)===0,'PRIVATE_STATE_PERMISSIONS_REQUIRED');
    }
    private static function need(bool $condition,string $code): void {if(!$condition)throw new \RuntimeException($code);}
    /** The copy cannot create lock files, sessions or receipts; it cannot be elevated back to a writer. */
    public function readOnlyCopy(): self {$copy=clone $this;$copy->readOnly=true;return $copy;}
    private static function text(mixed $value,int $max,bool $empty=false): string
    {self::need(is_string($value)&&strlen($value)<=$max&&($empty||trim($value)!=='')&&preg_match('//u',$value)===1&&!str_contains($value,"\0"),'TEXT_INVALID');return $value;}
    private static function json(mixed $value): string {return json_encode($value,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);}
    private static function canonical(mixed $value): mixed {if(!is_array($value))return $value;if(!array_is_list($value))ksort($value,SORT_STRING);foreach($value as &$child)$child=self::canonical($child);return $value;}
    private static function keys(array $value,array $allowed): void {self::need(!array_diff(array_keys($value),$allowed),'UNEXPECTED_INPUT');}
    private static function quantity(mixed $value): int
    {self::need(is_string($value)&&preg_match('/\A(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,6})?\z/D',$value)===1,'QUANTITY_INVALID');$parts=explode('.',$value);$number=(int)$parts[0]*self::SCALE+(int)str_pad($parts[1]??'',6,'0');self::need($number>0&&$number<=self::MAX_QUANTITY,'QUANTITY_OUT_OF_RANGE');return $number;}
    private static function quantityText(int $value): string {$fraction=rtrim(str_pad((string)($value%self::SCALE),6,'0',STR_PAD_LEFT),'0');return (string)intdiv($value,self::SCALE).($fraction!==''?'.'.$fraction:'');}
    private static function minorText(int $value): string {return intdiv($value,100).'.'.str_pad((string)($value%100),2,'0',STR_PAD_LEFT);}
    private static function money(mixed $money): ?array
    {
        if(!is_array($money)||!is_string($money['decimal']??null)||!preg_match('/\A(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?\z/D',$money['decimal'])||!in_array($money['currency']??null,['RUB','USD','EUR'],true))return null;
        $parts=explode('.',$money['decimal']);$minor=(int)$parts[0]*100+(int)str_pad($parts[1]??'',2,'0');
        if($minor<=0||$minor>100000000||!is_int($money['minor']??null)||$money['minor']!==$minor)return null;
        return ['minor'=>$minor,'decimal'=>self::minorText($minor),'currency'=>$money['currency']];
    }
    private function selection(string $itemId,?string $variantId): array
    {
        self::need(isset($this->items[$itemId]),'ITEM_NOT_FOUND');$item=$this->items[$itemId];self::need($item['is_product'],'NOT_PRODUCT');
        if($item['variants']){self::need($variantId!==null,'VARIANT_REQUIRED');foreach($item['variants'] as $variant)if($variant['id']===$variantId)return [$item,$variant];throw new \RuntimeException('VARIANT_NOT_FOUND');}
        self::need($variantId===null,'VARIANT_NOT_FOUND');return [$item,$item];
    }
    private static function pricing(array $source): array
    {
        $purchase=$source['purchase']??[];$reasons=[];$price=null;
        if(!is_array($purchase))$purchase=[];
        if(!is_array($purchase['blockers']??null)||($purchase['blockers']??[]))$reasons[]='SOURCE_PURCHASE_BLOCKED';
        $candidates=is_array($source['prices']??null)?array_values(array_filter($source['prices'],static fn($p)=>is_array($p)&&is_string($p['id']??null)&&$p['id']===($purchase['price_id']??null))):[];
        if(count($candidates)!==1)$reasons[]='PRICE_UNKNOWN_OR_AMBIGUOUS';else $price=$candidates[0];
        $money=$price?self::money($price['money']??null):null;
        if(!$money || ($price['totals_eligible']??null)!==true || ($price['status']??null)!=='OBSERVED' || ($price['role']??null)!=='CURRENT' || ($price['maximum']??null)!==null || ($price['conditions']??null)!==[])$reasons[]='PRICE_NOT_ELIGIBLE';
        $unit=$price['unit']??null;if(!is_string($unit)||trim($unit)===''||strlen($unit)>80)$reasons[]='UNIT_UNKNOWN';
        $policy=[];foreach(['min_quantity','quantity_step','max_quantity'] as $name){try{$policy[$name]=self::quantity($purchase[$name]??null);}catch(\Throwable){$policy[$name]=null;if(($purchase[$name]??null)!==null)$reasons[]='QUANTITY_POLICY_INVALID';}}
        if($policy['min_quantity']===null||$policy['quantity_step']===null)$reasons[]='QUANTITY_POLICY_UNKNOWN';
        if($policy['min_quantity']!==null&&$policy['max_quantity']!==null&&$policy['min_quantity']>$policy['max_quantity'])$reasons[]='QUANTITY_POLICY_INVALID';
        return ['eligible'=>!$reasons,'reasons'=>array_values(array_unique($reasons)),'money'=>$money,'unit'=>is_string($unit)?$unit:null,'policy'=>$policy,'price_id'=>$price['id']??null];
    }
    private static function validateQuantity(int $quantity,array $price): void
    {
        self::need($quantity>0&&$quantity<=self::MAX_QUANTITY,'QUANTITY_OUT_OF_RANGE');$p=$price['policy'];
        if($p['min_quantity']!==null)self::need($quantity>=$p['min_quantity'],'QUANTITY_BELOW_MINIMUM');
        if($p['max_quantity']!==null)self::need($quantity<=$p['max_quantity'],'QUANTITY_ABOVE_MAXIMUM');
        if($p['quantity_step']!==null)self::need(($quantity-($p['min_quantity']??0))%$p['quantity_step']===0,'QUANTITY_STEP_MISMATCH');
    }
    public function search(string $query,array $filters=[],string $sort='relevance',int $page=1,int $perPage=20): array
    {
        self::text($query,1000,true);self::need(mb_strlen($query,'UTF-8')<=200&&$page>=1&&$page<=10000&&$perPage>=1&&$perPage<=100,'SEARCH_LIMIT');self::keys($filters,['category_id','attributes','products_only']);
        self::need(in_array($sort,['relevance','title_asc','title_desc','price_asc','price_desc'],true),'SORT_INVALID');
        if(isset($filters['category_id']))self::text($filters['category_id'],240);
        self::need(!isset($filters['products_only'])||is_bool($filters['products_only']),'FILTER_INVALID');$attrs=$filters['attributes']??[];self::need(is_array($attrs)&&count($attrs)<=20,'FILTER_INVALID');
        foreach($attrs as $key=>$values){self::text($key,160);self::need(is_array($values)&&array_is_list($values)&&count($values)>0&&count($values)<=20,'FILTER_INVALID');foreach($values as $value)self::text($value,500);}
        $terms=preg_split('/\s+/u',mb_strtolower(trim($query),'UTF-8'),-1,PREG_SPLIT_NO_EMPTY);$rows=[];$priceKinds=[];
        foreach($this->items as $item){
            if(($filters['products_only']??false)&&!$item['is_product'])continue;if(isset($filters['category_id'])&&!in_array($filters['category_id'],$item['category_ids']??[],true))continue;
            $match=true;foreach($attrs as $key=>$values)if(!array_intersect($values,$item['attributes'][$key]??[]))$match=false;if(!$match)continue;
            $title=mb_strtolower($item['title'],'UTF-8');$haystack=$title."\n".mb_strtolower($item['body_text']??'','UTF-8');$score=0;
            foreach($terms as $term){if(!str_contains($haystack,$term)){$match=false;break;}$score+=str_contains($title,$term)?10:1;}if(!$match)continue;
            $price=self::pricing($item);if($price['eligible'])$priceKinds[$price['money']['currency']."\0".$price['unit']]=true;
            $rows[]=['id'=>$item['id'],'title'=>$item['title'],'request_target'=>$item['request_target'],'excerpt'=>mb_substr($item['body_text']??'',0,240,'UTF-8'),'is_product'=>$item['is_product'],'category_ids'=>$item['category_ids']??[],'attributes'=>$item['attributes']??[],'price'=>$price['eligible']?array_merge($price['money'],['unit'=>$price['unit']]):null,'price_blockers'=>$price['reasons'],'score'=>$score];
        }
        if(str_starts_with($sort,'price_'))self::need(count($priceKinds)<=1,'PRICE_SORT_INCOMPARABLE');
        usort($rows,static function($a,$b)use($sort){$fallback=strcmp(mb_strtolower($a['title'],'UTF-8'),mb_strtolower($b['title'],'UTF-8'))?:strcmp($a['id'],$b['id']);if($sort==='title_desc')return -$fallback;if($sort==='title_asc')return $fallback;if(str_starts_with($sort,'price_')){if(($a['price']===null)!==($b['price']===null))return $a['price']===null?1:-1;$cmp=($a['price']['minor']??0)<=>($b['price']['minor']??0);return ($sort==='price_desc'?-$cmp:$cmp)?:$fallback;}return ($b['score']<=>$a['score'])?:$fallback;});
        return ['status'=>$rows?'RESULTS':'NO_RESULTS','total'=>count($rows),'page'=>$page,'per_page'=>$perPage,'sort'=>$sort,'snapshot_id'=>$this->snapshot,'items'=>array_slice($rows,($page-1)*$perPage,$perPage)];
    }
    private function view(array $state): array
    {
        $lines=[];$totals=[];$blocked=false;$invalidSelection=false;$pricingBlockers=[];
        foreach($state['cart'] as $id=>$line){$reasons=[];$price=null;$item=$this->items[$line['item_id']]??null;
            try{[, $source]=$this->selection($line['item_id'],$line['variant_id']);$price=self::pricing($source);self::validateQuantity(self::quantity($line['quantity']),$price);$reasons=$price['reasons'];}catch(\Throwable $error){$reasons=['SELECTION_OR_QUANTITY_NO_LONGER_VALID'];$invalidSelection=true;}
            $subtotal=null;if(!$reasons&&$price){$minor=intdiv($price['money']['minor']*self::quantity($line['quantity'])+intdiv(self::SCALE,2),self::SCALE);$currency=$price['money']['currency'];$subtotal=['minor'=>$minor,'decimal'=>self::minorText($minor),'currency'=>$currency];$totals[$currency]=($totals[$currency]??0)+$minor;}else $blocked=true;
            $pricingBlockers=array_merge($pricingBlockers,$reasons);$lines[]=$line+['line_id'=>$id,'title'=>$item['title']??'Страница отсутствует в текущем снимке','request_target'=>$item['request_target']??null,'unit'=>$price['unit']??null,'unit_price'=>$price&&$price['eligible']?$price['money']:null,'subtotal'=>$subtotal,'blockers'=>$reasons];
        }
        $sums=[];ksort($totals);foreach($totals as $currency=>$minor)$sums[]=['currency'=>$currency,'minor'=>$minor,'decimal'=>self::minorText($minor)];
        if(count($sums)>1)$pricingBlockers[]='MULTIPLE_CURRENCIES';$total=$blocked||count($sums)!==1?null:$sums[0];
        return ['snapshot_id'=>$this->snapshot,'revision'=>$state['revision'],'lines'=>$lines,'known_subtotals'=>$sums,'total'=>$total,'pricing_status'=>!$lines?'EMPTY':($total===null?'REQUIRES_CONFIRMATION':'CALCULATED_FROM_OBSERVED_FACTS'),'pricing_blockers'=>array_values(array_unique($pricingBlockers)),'checkout_available'=>!$invalidSelection&&count($lines)>0,'demo'=>true,'real_payment_enabled'=>false];
    }
    private function locked(string $session,callable $callback,bool $existingOnly=false): mixed
    {
        // Check the effect, not a caller-supplied cookie or route classification.
        // Existing-only reads below retain the exact lock/integrity checks and cannot save.
        if($this->readOnly&&!$existingOnly)throw new DemoAdmissionRequired('DEMO_ADMISSION_REQUIRED');
        self::need((bool)preg_match('/\A[A-Za-z0-9_-]{32,128}\z/D',$session),'SESSION_INVALID');$sessionHash=hash('sha256',$this->project."\0".$session);$path=$this->directory.DIRECTORY_SEPARATOR.$sessionHash.'.json';$lockPath=$path.'.lock';
        self::need(!is_link($path)&&!is_link($lockPath),'STATE_SYMLINK');
        // An unrecognized cookie must never become a session or create a lock.
        if($existingOnly&&!file_exists($path))return null;
        self::need(!file_exists($path)||is_file($path),'STATE_PATH_INVALID');
        $lock=$existingOnly?@fopen($lockPath,'r+b'):fopen($lockPath,'c+b');self::need($lock!==false,'STATE_LOCK_FAILED');if(!$existingOnly)chmod($lockPath,0600);
        $deadline=hrtime(true)+3000000000;while(!flock($lock,LOCK_EX|LOCK_NB)){if(hrtime(true)>=$deadline){fclose($lock);throw new \RuntimeException('STATE_BUSY');}usleep(10000);}
        try{
            clearstatcache(true,$path);clearstatcache(true,$lockPath);
            self::need(!is_link($path)&&!is_link($lockPath),'STATE_SYMLINK');
            $held=fstat($lock);$named=@stat($lockPath);self::need(is_array($held)&&is_array($named)&&$held['dev']===$named['dev']&&$held['ino']===$named['ino'],'STATE_LOCK_CHANGED');
            if($existingOnly&&!file_exists($path))return null;
            self::need(!file_exists($path)||is_file($path),'STATE_PATH_INVALID');
            $new=!is_file($path);
            if($new)$state=['schema_version'=>1,'project_id'=>$this->project,'session_hash'=>$sessionHash,'csrf'=>bin2hex(random_bytes(32)),'revision'=>0,'cart'=>[],'operations'=>[],'synthetic_records'=>[]];
            else{self::need(filesize($path)<=self::MAX_STATE_BYTES,'STATE_LIMIT');$raw=file_get_contents($path);try{$envelope=json_decode((string)$raw,true,512,JSON_THROW_ON_ERROR);}catch(\Throwable){throw new \RuntimeException('STATE_CORRUPT');}self::need(is_array($envelope)&&is_array($envelope['body']??null)&&is_string($envelope['sha256']??null)&&hash_equals(hash('sha256',self::json($envelope['body'])),$envelope['sha256']),'STATE_CORRUPT');$state=$envelope['body'];
                self::need(($state['schema_version']??null)===1&&($state['project_id']??null)===$this->project&&($state['session_hash']??null)===$sessionHash&&is_string($state['csrf']??null)&&preg_match('/\A[a-f0-9]{64}\z/D',$state['csrf'])&&is_int($state['revision']??null)&&$state['revision']>=0&&is_array($state['cart']??null)&&is_array($state['operations']??null)&&is_array($state['synthetic_records']??null),'STATE_BINDING_INVALID');
            }
            [$result,$changed]=$callback($state);self::need(!$existingOnly||!$changed,'READ_ONLY_STATE_CHANGED');if($new||$changed)$this->save($path,$state);return $result;
        }finally{flock($lock,LOCK_UN);fclose($lock);}
    }
    private function save(string $path,array $state): void
    {
        if($this->readOnly)throw new DemoAdmissionRequired('DEMO_ADMISSION_REQUIRED');
        $bytes=self::json(['schema_version'=>1,'body'=>$state,'sha256'=>hash('sha256',self::json($state))]);self::need(strlen($bytes)<=self::MAX_STATE_BYTES,'STATE_LIMIT');$temporary=$path.'.pending-'.bin2hex(random_bytes(12));$handle=fopen($temporary,'x+b');self::need($handle!==false,'STATE_WRITE_FAILED');chmod($temporary,0600);
        try{$offset=0;while($offset<strlen($bytes)){$n=fwrite($handle,substr($bytes,$offset));self::need(is_int($n)&&$n>0,'STATE_WRITE_FAILED');$offset+=$n;}self::need(fflush($handle),'STATE_FLUSH_FAILED');if(function_exists('fsync'))self::need(fsync($handle),'STATE_SYNC_FAILED');}finally{fclose($handle);}
        // One rename commits cart + synthetic record + idempotency receipt together.
        // An unknown response is reconciled from this file before any repeated mutation.
        self::need(rename($temporary,$path),'STATE_COMMIT_FAILED');
    }
    public function openSession(string $session): array {return $this->locked($session,function(array &$state){return [['csrf'=>$state['csrf'],'cart'=>$this->view($state)],false];});}
    public function cart(string $session): array {return $this->locked($session,function(array &$state){return [$this->view($state),false];});}
    /** Resume only a server-created session; unknown identifiers have no filesystem side effect. */
    public function resumeSession(string $session): ?array {return $this->locked($session,function(array &$state){return [['csrf'=>$state['csrf'],'cart'=>$this->view($state)],false];},true);}
    /** Read the original committed response, without replaying or repricing its snapshot. */
    public function receipt(string $session,string $operationId): ?array
    {
        self::need(preg_match('/\A[a-f0-9]{64}\z/D',$operationId)===1,'OPERATION_ID_INVALID');
        return $this->locked($session,static function(array &$state)use($operationId){
            if(!array_key_exists($operationId,$state['operations']))return [null,false];
            $entry=$state['operations'][$operationId];$response=is_array($entry)?($entry['response']??null):null;
            self::need(is_array($entry)&&is_string($entry['request_sha256']??null)&&preg_match('/\A[a-f0-9]{64}\z/D',$entry['request_sha256'])===1&&is_array($response)&&($response['operation_id']??null)===$operationId&&($response['replayed']??null)===false&&is_string($response['snapshot_id']??null)&&preg_match('/\A[a-f0-9]{64}\z/D',$response['snapshot_id'])===1&&is_array($response['cart']??null)&&($response['cart']['snapshot_id']??null)===$response['snapshot_id']&&is_int($response['cart']['revision']??null)&&$response['cart']['revision']>0&&$response['cart']['revision']<=$state['revision'],'STATE_RECEIPT_INVALID');
            return [$response,false];
        },true);
    }
    public function mutate(string $session,string $csrf,string $idempotencyKey,string $action,array $payload): array
    {
        self::need(strlen($csrf)===64&&preg_match('/\A[a-f0-9]{64}\z/D',$csrf),'CSRF_INVALID');self::need(preg_match('/\A[A-Za-z0-9][A-Za-z0-9._:-]{15,127}\z/D',$idempotencyKey)===1,'IDEMPOTENCY_KEY_INVALID');self::need(strlen(self::json($payload))<=8192,'INPUT_LIMIT');
        self::need(in_array($action,['cart.add','cart.update','cart.remove','demo.lead','demo.checkout'],true),'ACTION_INVALID');$operation=hash('sha256',$idempotencyKey);$requestHash=hash('sha256',self::json(self::canonical([$action,$payload])));
        return $this->locked($session,function(array &$state)use($csrf,$action,$payload,$operation,$requestHash){
            self::need(hash_equals($state['csrf'],$csrf),'CSRF_INVALID');
            if(isset($state['operations'][$operation])){$prior=$state['operations'][$operation];self::need(hash_equals($prior['request_sha256'],$requestHash),'IDEMPOTENCY_CONFLICT');return [array_merge($prior['response'],['replayed'=>true]),false];}
            self::need(($payload['expected_snapshot_id']??null)===$this->snapshot,'SNAPSHOT_CHANGED');unset($payload['expected_snapshot_id']);
            self::need(count($state['operations'])<512,'SESSION_OPERATION_LIMIT');$record=null;
            if($action==='cart.add'){
                self::keys($payload,['item_id','variant_id','quantity']);$itemId=self::text($payload['item_id']??null,160);$variantId=$payload['variant_id']??null;if($variantId!==null)self::text($variantId,160);[, $source]=$this->selection($itemId,$variantId);$quantity=self::quantity($payload['quantity']??null);$lineId=hash('sha256',self::json([$itemId,$variantId]));
                if(isset($state['cart'][$lineId]))$quantity+=self::quantity($state['cart'][$lineId]['quantity']);self::validateQuantity($quantity,self::pricing($source));self::need(isset($state['cart'][$lineId])||count($state['cart'])<100,'CART_LINE_LIMIT');$state['cart'][$lineId]=['item_id'=>$itemId,'variant_id'=>$variantId,'quantity'=>self::quantityText($quantity)];
            }elseif($action==='cart.update'||$action==='cart.remove'){
                self::keys($payload,$action==='cart.update'?['line_id','quantity']:['line_id']);$id=self::text($payload['line_id']??null,64);self::need(isset($state['cart'][$id]),'CART_LINE_NOT_FOUND');if($action==='cart.remove')unset($state['cart'][$id]);else{[, $source]=$this->selection($state['cart'][$id]['item_id'],$state['cart'][$id]['variant_id']);$quantity=self::quantity($payload['quantity']??null);self::validateQuantity($quantity,self::pricing($source));$state['cart'][$id]['quantity']=self::quantityText($quantity);}
            }else{
                self::keys($payload,$action==='demo.lead'?['synthetic','identity','consent','topic','item_id']:['synthetic','identity','consent','delivery','payment']);self::need(($payload['synthetic']??null)===true&&($payload['identity']??null)==='demo-customer'&&($payload['consent']??null)===true,'SYNTHETIC_DATA_REQUIRED');self::need(count($state['synthetic_records'])<100,'SYNTHETIC_RECORD_LIMIT');
                if($action==='demo.lead'){self::need(in_array($payload['topic']??null,['general','product-question','delivery'],true),'LEAD_TOPIC_INVALID');if(isset($payload['item_id']))self::need(is_string($payload['item_id'])&&isset($this->items[$payload['item_id']]),'ITEM_NOT_FOUND');}
                else{self::need(($payload['delivery']??null)==='demo-pickup'&&($payload['payment']??null)==='demo-none','CHECKOUT_MODE_INVALID');self::need($this->view($state)['checkout_available'],'CART_NOT_CHECKOUT_ELIGIBLE');}
                $cart=$this->view($state);$record=['record_id'=>hash('sha256',$this->project.':'.$state['session_hash'].':'.$operation),'kind'=>$action,'status'=>'RECORDED_LOCALLY_SYNTHETIC','snapshot_id'=>$this->snapshot,'identity'=>'demo-customer','contact'=>['name'=>'Демо-покупатель','email'=>'demo@example.invalid'],'scenario'=>$payload,'cart'=>$cart,'pricing_status'=>$cart['pricing_status'],'total'=>$cart['total'],'pricing_blockers'=>$cart['pricing_blockers'],'native_order_created'=>false,'message_sent'=>false,'payment_attempted'=>false];$state['synthetic_records'][$record['record_id']]=$record;if($action==='demo.checkout')$state['cart']=[];
            }
            $state['revision']++;$response=['status'=>$record?'RECORDED_LOCALLY_SYNTHETIC':'DEMO_STATE_UPDATED','operation_id'=>$operation,'snapshot_id'=>$this->snapshot,'replayed'=>false,'cart'=>$this->view($state),'record'=>$record];$state['operations'][$operation]=['request_sha256'=>$requestHash,'response'=>$response];return [$response,true];
        });
    }
}
