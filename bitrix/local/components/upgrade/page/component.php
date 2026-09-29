<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED!==true) { die(); }
$arResult=['CONTENT'=>$GLOBALS['UPGRADE_CONTENT']??null,'ROUTE'=>$GLOBALS['UPGRADE_ROUTE']??null,'STATUS'=>$GLOBALS['UPGRADE_STATUS']??404];
$this->IncludeComponentTemplate();
