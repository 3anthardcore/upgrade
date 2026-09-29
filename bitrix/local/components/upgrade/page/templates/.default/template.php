<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED!==true) { die(); }
$content=$arResult['CONTENT'];
$escape=static fn($value): string=>htmlspecialchars((string)$value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
?>
<?php if (!$content): ?>
  <article class="document empty-state"><p class="eyebrow"><?= (int)$arResult['STATUS'] ?></p><h1><?= (int)$arResult['STATUS']===410?'Страница удалена':'Страница не найдена' ?></h1><p>Проверьте адрес или перейдите к доступным материалам.</p><a class="button" href="/">На главную</a></article>
<?php else: ?>
  <article class="document" data-upgrade-entity="<?= $escape($arResult['ROUTE']['ENTITY_KEY']) ?>">
    <p class="eyebrow">Снимок публичного источника</p>
    <h1><?= $escape($content['UPGRADE_PROPERTIES']['UG_H1']?:$content['NAME']) ?></h1>
    <?php if ($content['PREVIEW_TEXT']): ?><p class="lead"><?= $escape($content['PREVIEW_TEXT']) ?></p><?php endif ?>
    <div class="prose"><?php
    // Imported HTML is composed by our gateway exclusively from escaped model blocks.
    // Trusted owner edits in Bitrix remain visible; CSP blocks executable markup.
    echo $content['DETAIL_TEXT_TYPE']==='html'?$content['DETAIL_TEXT']:'<p>'.$escape($content['DETAIL_TEXT']).'</p>';
    ?></div>
    <?php if (($arResult['ROUTE']['ENTITY_TYPE']??'')==='product'): ?>
      <aside class="notice"><strong>Карточка из публичного снимка.</strong> Покупка, проверка наличия и актуализация цены в этой версии не подключены.</aside>
    <?php endif ?>
  </article>
<?php endif ?>
