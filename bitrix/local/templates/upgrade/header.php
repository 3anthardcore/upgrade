<?php if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED!==true) { die(); } ?>
<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title><?php $APPLICATION->ShowTitle(); ?></title><?php $APPLICATION->ShowMeta('description'); ?><link rel="stylesheet" href="/local/templates/upgrade/styles.css"></head>
<body><a class="skip-link" href="#main">К содержанию</a><div class="demo-banner">Концепция обновления · Демонстрация · Реальные обращения и платежи отключены</div>
<header class="site-header"><a class="brand" href="/" aria-label="На главную">Обновлённый сайт<span class="brand-dot" aria-hidden="true"></span></a>
<details class="site-menu"><summary>Материалы сайта</summary><nav aria-label="Основная навигация"><?php foreach (($GLOBALS['UPGRADE_NAVIGATION']??[]) as $link): ?><a href="<?= htmlspecialchars($link['href'],ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8') ?>"><?= htmlspecialchars($link['title'],ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8') ?></a><?php endforeach ?></nav></details></header>
<main id="main" class="main-shell">
