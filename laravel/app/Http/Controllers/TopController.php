<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class TopController extends Controller
{
    //
    public function top()
    {
        return view('top');
    }
    public function create()
    {
        return view('card.create');
    }
    public function study()
    {
        return view('card.study');
    }
    public function all()
    {
        return view('card.all');
    }
}
