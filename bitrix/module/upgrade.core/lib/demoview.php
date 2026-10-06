<?php
declare(strict_types=1);
namespace Upgrade\Core;

/** Escaped presentation only. All actions use the isolated DemoWeb contract. */
final class DemoView
{
    private static function e(mixed $value): string { return htmlspecialchars(is_scalar($value)?(string)$value:'',ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
    private static function route(mixed $value): ?string
    {
        return is_string($value)&&strlen($value)<=8192&&str_starts_with($value,'/')&&!str_starts_with($value,'//')&&!preg_match('/[\x00-\x20\x7f\\\\#]/',$value)?$value:null;
    }
    private static function image(mixed $value): ?string
    {
        return is_string($value)&&preg_match('~\A/upload/upgrade/[a-z0-9][a-z0-9-]{0,62}/[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|gif|avif)\z~D',$value)?$value:null;
    }
    private static function decimal(mixed $value): ?string { return is_string($value)&&preg_match('/\A(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,6})?\z/D',$value)?$value:null; }
    private static function amount(mixed $value): ?string
    {
        if(!is_array($value)||self::decimal($value['decimal']??null)===null||!is_string($value['currency']??null)||!preg_match('/\A[A-Z]{3}\z/D',$value['currency']))return null;
        $parts=explode('.',$value['decimal']);$whole=preg_replace('/\B(?=(\d{3})+(?!\d))/u',"\u{202F}",$parts[0]);
        return $whole.(isset($parts[1])?','.$parts[1]:'').' '.(['RUB'=>'₽','USD'=>'USD','EUR'=>'€','GBP'=>'GBP','JPY'=>'JPY'][$value['currency']]??$value['currency']);
    }
    private static function unit(mixed $value): string { return is_string($value)?(['piece'=>'шт.','m'=>'м','m2'=>'м²','pack'=>'упак.','set'=>'комплект'][$value]??$value):''; }
    private static function facetLabel(mixed $value): string { return is_string($value)?(['brand'=>'Бренд','color'=>'Цвет','size'=>'Размер','material'=>'Материал','sku'=>'Артикул'][$value]??$value):''; }
    private static function hidden(string $name,mixed $value): string { return '<input type="hidden" name="'.self::e($name).'" value="'.self::e($value).'">'; }
    private static function startForm(array $view,string $action,array $fields=[]): string
    {
        if(!is_string($view['csrf']??null)||!preg_match('/\A[a-f0-9]{64}\z/D',$view['csrf'])||!is_string($view['snapshot_id']??null)||!preg_match('/\A[a-f0-9]{64}\z/D',$view['snapshot_id']))throw new \RuntimeException('VIEW_FORM_BINDING_INVALID');
        $out='<form method="post" action="/__upgrade/action" class="demo-action">'.self::hidden('action',$action).self::hidden('csrf',$view['csrf']).self::hidden('expected_snapshot_id',$view['snapshot_id']).self::hidden('idempotency_key','view-'.bin2hex(random_bytes(24)));
        foreach($fields as $name=>$value)$out.=self::hidden($name,$value);return $out;
    }
    private static function photo(array $item,string $class='demo-photo'): string
    {
        $image=self::image($item['thumbnail']??null);
        return '<div class="'.$class.($image?'':' is-missing').'">'.($image?'<img src="'.self::e($image).'" alt="'.self::e($item['title']??'').'" loading="lazy" width="600" height="600">':'<span class="demo-photo-missing">Изображение не перенесено</span>').'</div>';
    }
    private static function selected(mixed $actual,mixed $expected): string { return $actual===$expected?' selected':''; }
    private static function label(array $variant,int $index=0): string
    {
        $parts=[];$sku=$variant['sku']??null;if(is_array($sku)&&is_string($sku['value']??null)&&$sku['value']!=='')$parts[]=$sku['value'];
        foreach($variant['attributes']??[] as $name=>$field){$value=is_array($field)?($field['value']??null):$field;if(is_string($value)&&$value!=='')$parts[]=$value;}
        return $parts?implode(' · ',array_unique($parts)):'Вариант '.($index+1);
    }
    private static function quantityInput(array $source,string $value,string $label,string $suffix): string
    {
        $purchase=is_array($source['purchase']??null)?$source['purchase']:[];$min=self::decimal($purchase['min_quantity']??null);$step=self::decimal($purchase['quantity_step']??null);$max=self::decimal($purchase['max_quantity']??null);
        $maximumWithinCap=$max!==null&&(strlen(explode('.',$max)[0])<5||($max==='10000'));
        $out='<label class="demo-field demo-quantity" for="qty-'.self::e($suffix).'">'.self::e($label).'<input id="qty-'.self::e($suffix).'" name="quantity" type="number" inputmode="decimal" required min="'.self::e($min??'0.000001').'" max="'.self::e($maximumWithinCap?$max:'10000').'" step="'.self::e($step??'any').'" value="'.self::e($value).'" aria-describedby="qty-note-'.self::e($suffix).'"></label>';
        $facts=[];if($min!==null)$facts[]='Минимум: '.$min;if($step!==null)$facts[]='Шаг: '.$step;if($max!==null)$facts[]='Максимум на странице: '.$max;
        $note=$facts?implode(' · ',$facts).'. ':'';
        if($min===null||$step===null)$note.='Правила количества источника не установлены. Введённое значение используется только в демо.';
        else $note.='Количество из сохранённых условий. Демо ограничено 10 000 единицами.';
        return $out.'<p class="demo-hint" id="qty-note-'.self::e($suffix).'">'.self::e($note).'</p>';
    }
    private static function priceRows(array $source): string
    {
        $out='';foreach($source['prices']??[] as $price){if(!is_array($price))continue;$role=$price['role']??'UNKNOWN';$formatted=self::amount($price['money']??null);$observed=($price['status']??null)==='OBSERVED';
            $label=$role==='CURRENT'?'Цена на странице источника':($role==='OLD'?'Прежняя цена на странице':($role==='FROM'?'Цена от на странице':($role==='RANGE'?'Диапазон цены на странице':'Цена на странице источника')));
            $value=$observed&&$formatted!==null?$formatted:(string)($price['raw_text']??'Цена требует уточнения');
            if($role==='FROM'&&$observed&&$formatted!==null)$value='от '.$value;
            if($role==='RANGE'&&$observed&&$formatted!==null){$maximum=self::amount($price['maximum']??null);$value=$maximum!==null?$formatted.' — '.$maximum:(string)($price['raw_text']??'Цена требует уточнения');}
            $out.='<div class="demo-price-row'.($role==='OLD'?' is-old':'').'"><span class="demo-hint">'.self::e($label).'</span><'.($role==='OLD'?'s':'strong').' class="demo-price">'.self::e($value).'</'.($role==='OLD'?'s':'strong').'>';
            if($price['unit']??null)$out.='<span class="demo-unit">за '.self::e(self::unit($price['unit'])).'</span>';
            if(!empty($price['conditions']))$out.='<p class="demo-hint">На странице есть дополнительные или неоднозначные условия цены. Проверьте описание ниже; сумма требует уточнения.</p>';
            $out.='</div>';
        }
        return $out?:'<p class="demo-unknown">Цена требует уточнения</p>';
    }
    private static function purchaseForm(array $view,array $item,array $source,?string $variant=null): string
    {
        $suffix='add-'.substr(hash('sha256',(string)$item['id'].':'.($variant??'')),0,16);$p=$source['purchase']??[];
        $value=self::decimal($p['default_quantity']??null)??self::decimal($p['min_quantity']??null)??'1';
        $fields=['item_id'=>$item['id']];if($variant!==null)$fields['variant_id']=$variant;
        $unknown=!empty($p['blockers'])?'<p class="demo-hint">Итоговая сумма требует уточнения: в сохранённых ценах или условиях есть неизвестные значения.</p>':'';
        return $unknown.self::startForm($view,'cart.add',$fields).self::quantityInput($source,$value,'Количество',$suffix).'<button type="submit" class="demo-button">Добавить в демо-корзину <span aria-hidden="true">↗</span></button></form>';
    }
    private static function product(array $view): string
    {
        $item=$view['item']??[];$out='<section class="demo-product" aria-label="Товар и демо-корзина">'.self::photo($item,'demo-product-photo').'<div class="demo-purchase-panel"><p class="eyebrow">Сохранённая карточка товара</p>';
        $variants=is_array($item['variants']??null)?$item['variants']:[];
        if(!$variants)$out.=self::priceRows($item).self::purchaseForm($view,$item,$item);
        else{$out.='<h2 class="demo-section-title">Выберите вариант</h2><p class="demo-hint">Показаны только варианты, найденные на исходной странице.</p><div class="demo-variants">';foreach($variants as $index=>$variant){$out.='<details class="demo-variant"><summary>'.self::e(self::label($variant,$index)).'</summary><div class="demo-variant-body">'.self::priceRows($variant).self::purchaseForm($view,$item,$variant,(string)$variant['id']).'</div></details>';}$out.='</div>';}
        $out.='<div class="demo-callout"><strong>Это демонстрация</strong><p>Корзина сохраняется в текущей сессии браузера. Реальный заказ, отправка заявки и оплата отключены.</p></div><a class="demo-text-link" href="/__upgrade/cart">Открыть корзину <span aria-hidden="true">→</span></a></div></section>';
        return $out;
    }
    private static function search(array $view): string
    {
        $query=$view['query']??[];$search=$view['search']??[];$out='<header class="demo-page-heading"><p class="eyebrow">Каталог и материалы</p><h1>Найдите нужное</h1><p class="lead">Поиск по перенесённым страницам сайта.</p></header><div class="demo-search-layout"><aside class="demo-filter-panel"><form method="get" action="/__upgrade/search"><label class="demo-field">Название или характеристика<input type="search" name="q" maxlength="200" value="'.self::e($query['q']??'').'" placeholder="Что вы ищете?"></label>';
        if(!empty($view['categories'])){$out.='<label class="demo-field">Раздел<select name="category"><option value="">Все разделы</option>';foreach($view['categories'] as $category)$out.='<option value="'.self::e($category['id']).'"'.self::selected($query['category']??'',$category['id']).'>'.self::e($category['label']).'</option>';$out.='</select></label>';}
        foreach($view['filters']??[] as $filter){if(!preg_match('/\Aa(?:[0-9]|1[0-9])\z/D',(string)($filter['key']??'')))continue;$out.='<label class="demo-field">'.self::e(self::facetLabel($filter['label']??$filter['name'])).'<select name="'.self::e($filter['key']).'"><option value="">Все значения</option>';foreach($filter['values']??[] as $value)$out.='<option value="'.self::e($value).'"'.self::selected($query['attributes'][$filter['key']]??'',$value).'>'.self::e($value).'</option>';$out.='</select></label>';}
        $out.='<label class="demo-field">Порядок<select name="sort">';foreach(['relevance'=>'По совпадению','title_asc'=>'Название: А—Я','title_desc'=>'Название: Я—А','price_asc'=>'Цена: по возрастанию','price_desc'=>'Цена: по убыванию'] as $value=>$label)$out.='<option value="'.$value.'"'.self::selected($query['sort']??'relevance',$value).'>'.$label.'</option>';
        $out.='</select></label><button class="demo-button" type="submit">Показать результаты</button><a class="demo-text-link" href="/__upgrade/search">Сбросить фильтры</a></form>'.(!empty($view['facets_limited'])?'<p class="demo-hint">Показана часть доступных фильтров. Поиск учитывает все перенесённые страницы.</p>':'').'</aside><div class="demo-results"><div class="demo-results-bar"><p>Найдено страниц: <strong>'.(int)($search['total']??0).'</strong></p><span class="demo-hint">В сохранённой части сайта</span></div>';
        if(empty($search['items']))$out.='<div class="demo-empty"><span class="demo-empty-mark" aria-hidden="true">⌕</span><h2>Ничего не найдено</h2><p>Измените запрос или уберите часть фильтров.</p><a class="demo-button is-secondary" href="/__upgrade/search">Показать все страницы</a></div>';
        else{$out.='<div class="demo-result-grid">';foreach($search['items'] as $row){$item=$view['items'][$row['id']]??[];$route=self::route($row['request_target']??null);$price=self::amount($row['price']??null);$out.='<article class="demo-result-card">'.($route?'<a class="demo-image-link" tabindex="-1" aria-hidden="true" href="'.self::e($route).'">':'').self::photo($item+['title'=>$row['title']]).($route?'</a>':'').'<div class="demo-result-copy"><h2>'.($route?'<a href="'.self::e($route).'">':'').self::e($row['title']).($route?'</a>':'').'</h2><p class="demo-result-excerpt">'.self::e($row['excerpt']??'').'</p>';
            if($row['is_product']??false)$out.='<p class="demo-result-price">'.($price?self::e($price).'<span> / '.self::e(self::unit($row['price']['unit']??'')).'</span>':'<span>Цена требует уточнения</span>').'</p>';
            if($route)$out.='<a class="demo-card-link" href="'.self::e($route).'">Открыть страницу <span aria-hidden="true">↗</span></a>';$out.='</div></article>';}$out.='</div>';}
        $page=max(1,(int)($search['page']??1));$per=max(1,(int)($search['per_page']??20));$pages=(int)ceil((int)($search['total']??0)/$per);
        if($pages>1){$params=['q'=>$query['q']??'','category'=>$query['category']??'','sort'=>$query['sort']??'relevance'];foreach($query['attributes']??[] as $key=>$value)if(preg_match('/\Aa(?:[0-9]|1[0-9])\z/D',(string)$key))$params[$key]=$value;
            $out.='<div class="demo-pagination" aria-label="Страницы результатов">';if($page>1)$out.='<a class="demo-button is-secondary" rel="prev" href="'.self::e('/__upgrade/search?'.http_build_query($params+['page'=>$page-1],'','&',PHP_QUERY_RFC3986)).'">← Назад</a>';$out.='<span>Страница '.$page.' из '.$pages.'</span>';if($page<$pages)$out.='<a class="demo-button is-secondary" rel="next" href="'.self::e('/__upgrade/search?'.http_build_query($params+['page'=>$page+1],'','&',PHP_QUERY_RFC3986)).'">Далее →</a>';$out.='</div>';}
        return $out.'</div></div>';
    }
    private static function synthetic(array $view,string $action): string
    {
        $fields=['synthetic'=>'1','identity'=>'demo-customer'];if($action==='demo.checkout')$fields+=['delivery'=>'demo-pickup','payment'=>'demo-none'];
        $out=self::startForm($view,$action,$fields);
        if($action==='demo.lead'){$out.='<label class="demo-field">Тема тестового обращения<select name="topic"><option value="general">Общий вопрос</option><option value="product-question">Вопрос о товаре</option><option value="delivery">Доставка</option></select></label>';if(is_string($view['item']['id']??null))$out.=self::hidden('item_id',$view['item']['id']);}
        $out.='<label class="demo-consent"><input type="checkbox" name="consent" value="1" required><span>Понимаю: это тестовая запись без покупки и отправки сообщения.</span></label><button type="submit" class="demo-button">'.($action==='demo.checkout'?'Проверить оформление':'Создать тестовое обращение').'</button></form>';
        return $out;
    }
    private static function cart(array $view): string
    {
        $cart=$view['cart']??[];$out='<header class="demo-page-heading"><p class="eyebrow">Текущая сессия браузера</p><h1>Демо-корзина</h1><p class="lead">Проверьте выбор и количество. Реальная покупка здесь не совершается.</p></header>';
        if(empty($cart['lines']))return $out.'<div class="demo-empty"><span class="demo-empty-mark" aria-hidden="true">＋</span><h2>В корзине пока ничего нет</h2><p>Добавьте товар из перенесённого каталога.</p><a class="demo-button" href="/__upgrade/search">Перейти к поиску</a></div>';
        $out.='<div class="demo-cart-layout"><div class="demo-cart-lines">';foreach($cart['lines'] as $line){$item=$view['items'][$line['item_id']]??[];$source=$item;$label='';foreach($item['variants']??[] as $index=>$variant)if(($variant['id']??null)===($line['variant_id']??null)){$source=$variant;$label=self::label($variant,$index);}
            $route=self::route($line['request_target']??null);$out.='<article class="demo-cart-line">'.self::photo($item+['title'=>$line['title']]).'<div class="demo-cart-copy"><h2>'.($route?'<a href="'.self::e($route).'">':'').self::e($line['title']).($route?'</a>':'').'</h2>'.($label?'<p class="demo-hint">'.self::e($label).'</p>':'');
            $unitPrice=self::amount($line['unit_price']??null);if($unitPrice)$out.='<p class="demo-hint">'.self::e($unitPrice).' / '.self::e(self::unit($line['unit']??null)).'</p>';
            $out.=self::startForm($view,'cart.update',['line_id'=>$line['line_id']]).self::quantityInput($source,(string)$line['quantity'],'Количество','line-'.substr((string)$line['line_id'],0,16)).'<button type="submit" class="demo-button is-secondary">Обновить</button></form>'.self::startForm($view,'cart.remove',['line_id'=>$line['line_id']]).'<button type="submit" class="demo-remove">Удалить из корзины</button></form></div><div class="demo-line-total">'.self::e(self::amount($line['subtotal']??null)??'Требует уточнения').'</div></article>';
        }
        $total=self::amount($cart['total']??null);$out.='</div><aside class="demo-cart-summary"><h2>Ваш выбор</h2><p class="demo-hint">Позиций: '.count($cart['lines']).'</p><div class="demo-total"><span>Сумма</span><strong>'.self::e($total??'Требует уточнения').'</strong></div>';
        if($total===null)$out.='<p class="demo-callout">Для расчёта не хватает однозначных цен или условий количества. Сумма не заменяется нулём; тестовая запись сохранит это ограничение.</p>';
        else $out.='<p class="demo-hint">Рассчитано по сохранённым фактам источника. Это не предложение оплаты.</p>';
        if($cart['checkout_available']??false)$out.=self::synthetic($view,'demo.checkout');else $out.='<p class="demo-callout" role="status">Некоторые позиции или количества больше не соответствуют снимку. Обновите или удалите их перед проверкой оформления.</p>';
        return $out.'<a class="demo-text-link" href="/__upgrade/search">Продолжить поиск →</a></aside></div>';
    }
    private static function receipt(array $view): string
    {
        $record=$view['record']??[];
        if(($record['status']??null)!=='RECORDED_LOCALLY_SYNTHETIC'||!in_array($record['kind']??null,['demo.lead','demo.checkout'],true)||($record['native_order_created']??null)!==false||($record['message_sent']??null)!==false||($record['payment_attempted']??null)!==false)return '<div class="demo-empty"><h1>Тестовая запись не подтверждена</h1><p>Вернитесь в корзину и проверьте сохранённый результат.</p><a class="demo-button" href="/__upgrade/cart">Открыть корзину</a></div>';
        $cart=$record['cart']??[];$out='<div class="demo-receipt"><span class="demo-receipt-mark" aria-hidden="true">✓</span><p class="eyebrow">Тестовый сценарий</p><h1>Демо-запись сохранена</h1><p class="lead">Сообщение не отправлено. Реальный заказ и платёж не создавались.</p><dl class="demo-receipt-facts"><div><dt>Сценарий</dt><dd>'.(($record['kind']??null)==='demo.checkout'?'Тестовое оформление':'Тестовое обращение').'</dd></div><div><dt>Участник</dt><dd>Демо-покупатель</dd></div><div><dt>Сумма</dt><dd>'.self::e(self::amount($record['total']??null)??'Требует уточнения').'</dd></div></dl>';
        if(!empty($cart['lines'])){$out.='<h2>Сохранённые позиции</h2><ul class="demo-receipt-lines">';foreach($cart['lines'] as $line)$out.='<li><span>'.self::e($line['title']??'').'</span><span>'.self::e($line['quantity']??'').'</span><strong>'.self::e(self::amount($line['subtotal']??null)??'Требует уточнения').'</strong></li>';$out.='</ul>';}
        if(($record['total']??null)===null)$out.='<p class="demo-callout">Сумма требует уточнения. Неизвестные цены и условия сохранены без предположений.</p>';
        return $out.'<div class="demo-inline-actions"><a class="demo-button" href="/__upgrade/search">Вернуться к поиску</a><a class="demo-button is-secondary" href="/__upgrade/cart">Открыть корзину</a></div></div>';
    }
    public static function render(array $view): string
    {
        $kind=$view['kind']??'error';$message=is_string($view['message']??null)&&$view['message']!==''?'<div class="demo-message" role="status">'.self::e($view['message']).'</div>':'';
        $body=match($kind){
            'search'=>self::search($view),'product'=>self::product($view),'cart'=>self::cart($view),'receipt'=>self::receipt($view),
            'lead'=>'<div class="demo-lead"><p class="eyebrow">Без отправки сообщения</p><h1>Тестовое обращение</h1><p class="lead">Проверка формы создаёт только локальную запись с вымышленным демо-покупателем. Имя, телефон и email вводить не нужно.</p>'.self::synthetic($view,'demo.lead').'</div>',
            default=>'<div class="demo-empty"><h1>Не удалось выполнить действие</h1><p>Обновите страницу и повторите попытку. Если данные изменились, проверьте корзину.</p><a class="demo-button" href="/__upgrade/cart">Открыть корзину</a></div>',
        };
        return '<div class="demo-view">'.$message.$body.'</div>';
    }
}
